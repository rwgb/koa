import Foundation
import SwiftUI

@Observable
final class AppState {
    // Auth
    var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    var bearerToken: String = KeychainHelper.get("bearerToken") ?? ""
    var isAuthenticated: Bool = false

    // Navigation
    var selectedTab: Tab = .chat

    // Chat
    var messages: [ChatMessage] = []
    var isAgentBusy: Bool = false

    // Tasks
    var tasks: [KoaTask] = []
    var projects: [KoaProject] = []

    // Push
    var apnsToken: String?
    var pushEnabled: Bool = false

    enum Tab: String, CaseIterable {
        case chat, board, search, settings
        var label: String { rawValue.capitalized }
        var icon: String {
            switch self {
            case .chat: return "bubble.left.and.bubble.right"
            case .board: return "kanban"
            case .search: return "magnifyingglass"
            case .settings: return "gearshape"
            }
        }
    }

    func save() {
        UserDefaults.standard.set(serverURL, forKey: "serverURL")
        KeychainHelper.set("bearerToken", bearerToken)
        WatchBridge.shared.syncCredentials(serverURL: serverURL, bearerToken: bearerToken)
    }

    // Returns the base URL with no trailing slash.
    var baseURL: String { serverURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
}
