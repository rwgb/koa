import AppIntents
import Foundation

// MARK: - "Ask Koa what's next" Siri Shortcut

struct AskKoaIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Koa What's Next"
    static var description = IntentDescription("Ask Koa AI assistant for your next priority.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let baseURL = UserDefaults.standard.string(forKey: "serverURL") ?? ""
        let token = KeychainHelper.get("bearerToken") ?? ""
        guard !baseURL.isEmpty else {
            throw IntentError.notConfigured
        }
        let api = KoaAPI(baseURL: baseURL, token: token)
        guard let req = api.sseRequest(message: "What should I focus on next?") else {
            throw IntentError.notConfigured
        }
        var response = ""
        for await event in SseStream.open(req) {
            if event.type == "content", let text = event.text { response = text }
            if event.type == "done" || event.type == "error" { break }
        }
        return .result(value: response.isEmpty ? "No response from Koa." : response)
    }
}

// MARK: - "Mark task done" Siri Shortcut

struct MarkTaskDoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark Koa Task Done"
    static var description = IntentDescription("Mark a specific Koa task as done.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Task ID")
    var taskId: String

    @Parameter(title: "Task Title")
    var taskTitle: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let baseURL = UserDefaults.standard.string(forKey: "serverURL") ?? ""
        let token = KeychainHelper.get("bearerToken") ?? ""
        guard !baseURL.isEmpty else { throw IntentError.notConfigured }
        let api = KoaAPI(baseURL: baseURL, token: token)
        let updated = try await api.updateTask(taskId: taskId, updates: ["status": "done"])
        return .result(value: "Marked '\(updated.title)' as done.")
    }
}

// MARK: - App Shortcuts (autoconfigures Siri phrases)

struct KoaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskKoaIntent(),
            phrases: [
                "Ask \(.applicationName) what's next",
                "What should I work on in \(.applicationName)",
            ],
            shortTitle: "What's next?",
            systemImageName: "brain.head.profile"
        )
    }
}

// MARK: - Errors

enum IntentError: Error, LocalizedError {
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Koa is not configured. Open the app and connect to your server first."
        }
    }
}
