import Foundation
import WatchConnectivity

// Receives credentials from the iOS companion app via WatchConnectivity.
// Stores serverURL + bearerToken in watch-local UserDefaults (NOT shared App Group).
final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSession()

    private let defaults = UserDefaults.standard

    // Published so views can react when credentials arrive.
    @Published var serverURL: String = ""
    @Published var bearerToken: String = ""
    @Published var isConfigured: Bool = false

    private override init() {
        serverURL = defaults.string(forKey: "koa_serverURL") ?? ""
        bearerToken = defaults.string(forKey: "koa_bearerToken") ?? ""
        isConfigured = !serverURL.isEmpty && !bearerToken.isEmpty
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    // Credentials sent via updateApplicationContext or transferUserInfo from iOS.
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        applyContext(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        applyContext(userInfo)
    }

    private func applyContext(_ dict: [String: Any]) {
        guard let url = dict["serverURL"] as? String,
              let token = dict["bearerToken"] as? String,
              !url.isEmpty, !token.isEmpty
        else { return }
        defaults.set(url, forKey: "koa_serverURL")
        defaults.set(token, forKey: "koa_bearerToken")
        DispatchQueue.main.async {
            self.serverURL = url
            self.bearerToken = token
            self.isConfigured = true
        }
    }

    // MARK: - Chat

    func sendChat(message: String) async throws -> String {
        guard !serverURL.isEmpty else { throw WatchError.notConfigured }
        var comps = URLComponents(string: serverURL.trimmingCharacters(in: .init(charactersIn: "/")) + "/api/sse/chat")
        comps?.queryItems = [
            URLQueryItem(name: "message", value: message),
            URLQueryItem(name: "format", value: "brief"),
        ]
        guard let url = comps?.url else { throw WatchError.invalidURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 120
        if !bearerToken.isEmpty { req.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }

        let (bytes, _) = try await URLSession.shared.bytes(for: req)
        var content = ""
        var currentEvent = ""
        for try await line in bytes.lines {
            if line.hasPrefix("event: ") {
                currentEvent = String(line.dropFirst(7))
            } else if line.hasPrefix("data: ") {
                let json = String(line.dropFirst(6))
                if currentEvent == "done",
                   let data = json.data(using: .utf8),
                   let obj = try? JSONDecoder().decode(DonePayload.self, from: data) {
                    content = obj.content
                    break
                } else if currentEvent == "content",
                          let data = json.data(using: .utf8),
                          let obj = try? JSONDecoder().decode(ContentPayload.self, from: data) {
                    content = obj.text ?? ""
                }
            } else if line.isEmpty {
                currentEvent = ""
            }
        }
        return content.isEmpty ? "(no response)" : content
    }

    private struct DonePayload: Decodable {
        let content: String
    }

    private struct ContentPayload: Decodable {
        let text: String?
    }
}

enum WatchError: LocalizedError {
    case notConfigured
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Open the Koa iOS app to sync credentials."
        case .invalidURL: return "Invalid server URL."
        }
    }
}
