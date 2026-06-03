import Foundation

// REST API client. Callers supply the base URL and bearer token from AppState.
struct KoaAPI {
    let baseURL: String
    let token: String

    // MARK: - Auth

    func ping() async throws {
        let (_, response) = try await request("/api/ping", method: "GET")
        guard httpStatus(response) == 200 else { throw KoaError.unauthorized }
    }

    // MARK: - Tasks

    func fetchTasks(projectId: String? = nil) async throws -> [KoaTask] {
        var path = "/api/tasks"
        if let projectId { path += "?projectId=\(projectId)" }
        let (data, _) = try await request(path, method: "GET")
        return try decode([KoaTask].self, from: data)
    }

    func fetchProjects() async throws -> [KoaProject] {
        let (data, _) = try await request("/api/projects", method: "GET")
        return try decode([KoaProject].self, from: data)
    }

    func updateTask(taskId: String, updates: [String: Any]) async throws -> KoaTask {
        let body = try JSONSerialization.data(withJSONObject: updates)
        let (data, _) = try await request("/api/tasks/\(taskId)", method: "PUT", body: body)
        let wrapper = try decode(TaskUpdateResponse.self, from: data)
        return wrapper.task
    }

    private struct TaskUpdateResponse: Decodable {
        let task: KoaTask
    }

    // MARK: - APNs token registration

    func registerApnsToken(_ token: String) async throws {
        let body = try JSONEncoder().encode(["token": token])
        let (_, response) = try await request("/api/push/apns-token", method: "POST", body: body)
        guard httpStatus(response) == 200 else { throw KoaError.serverError("Failed to register APNs token") }
    }

    func unregisterApnsToken() async throws {
        let (_, response) = try await request("/api/push/apns-token", method: "DELETE")
        guard httpStatus(response) == 200 else { throw KoaError.serverError("Failed to unregister APNs token") }
    }

    // MARK: - Voice transcription

    func transcribeAudio(fileURL: URL) async throws -> String {
        let base = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + "/api/voice/transcribe") else { throw KoaError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.setValue("audio/m4a", forHTTPHeaderField: "Content-Type")
        req.httpBody = try Data(contentsOf: fileURL)
        let (data, _) = try await URLSession.shared.data(for: req)
        let response = try JSONDecoder().decode(TranscribeResponse.self, from: data)
        return response.text
    }

    private struct TranscribeResponse: Decodable {
        let text: String
    }

    // MARK: - Static transcribe helper (for background use without AppState instance)

    static func transcribeAudio(fileURL: URL) async throws -> String {
        let serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? ""
        let token = KeychainHelper.get("bearerToken") ?? ""
        let base = serverURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !base.isEmpty, let url = URL(string: base + "/api/voice/transcribe") else {
            throw KoaError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.setValue("audio/m4a", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Data(contentsOf: fileURL)
        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(TranscribeResponse.self, from: data)
        return response.text
    }

    // MARK: - Internal

    private func request(
        _ path: String,
        method: String,
        body: Data? = nil
    ) async throws -> (Data, URLResponse) {
        let base = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + path) else { throw KoaError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return try await URLSession.shared.data(for: req)
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        return try decoder.decode(type, from: data)
    }

    private func httpStatus(_ response: URLResponse) -> Int {
        (response as? HTTPURLResponse)?.statusCode ?? 0
    }

    // MARK: - Notification reply (static — called from background without an AppState instance)

    // Reads serverURL and bearerToken from the same UserDefaults keys that AppState persists to.
    static func sendNotificationReply(message: String) async {
        let serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? ""
        let token = KeychainHelper.get("bearerToken") ?? ""
        guard !serverURL.isEmpty,
              let url = URL(string: serverURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/push/reply")
        else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["message": message])
        _ = try? await URLSession.shared.data(for: request)
    }
}

// SSE stream URL builder (separate from KoaAPI REST to keep the types clean).
extension KoaAPI {
    func sseURL(message: String) -> URL? {
        var comps = URLComponents(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/sse/chat")
        comps?.queryItems = [
            URLQueryItem(name: "message", value: message),
            URLQueryItem(name: "format", value: "brief"),
        ]
        return comps?.url
    }

    func sseRequest(message: String) -> URLRequest? {
        guard let url = sseURL(message: message) else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 300
        return req
    }
}

enum KoaError: LocalizedError {
    case unauthorized
    case invalidURL
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Authorization required — check your bearer token."
        case .invalidURL: return "Invalid server URL."
        case .serverError(let msg): return msg
        }
    }
}
