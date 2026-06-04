import SwiftUI
import UserNotifications

@main
struct KoaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var state = AppState()

    var body: some Scene {
        WindowGroup {
            if state.isAuthenticated {
                MainTabView()
                    .environment(state)
            } else {
                AuthView()
                    .environment(state)
            }
        }
    }
}

// MARK: - AppDelegate (APNs registration)

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    // Posted after successful APNs registration so SettingsView can pick it up.
    static let apnsTokenKey = "apnsDeviceToken"

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        // Register interactive notification categories for lock-screen replies
        let replyAction = UNTextInputNotificationAction(
            identifier: "KOA_REPLY_ACTION",
            title: "Reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Message Koa…"
        )
        let koaCategory = UNNotificationCategory(
            identifier: "KOA_REPLY",
            actions: [replyAction],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([koaCategory])

        return true
    }

    // Called after the user grants push permission and APNs assigns a device token.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: Self.apnsTokenKey)
        NotificationCenter.default.post(name: .apnsTokenRegistered, object: token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[koa] APNs registration failed:", error)
    }

    // Show notifications even when app is in foreground (e.g. escalation alerts).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler handler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        handler([.banner, .sound, .badge])
    }

    // Deep link: tap notification → open task detail.
    // Reply action: long-press notification → type reply → send to agent loop.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler handler: @escaping () -> Void
    ) {
        if response.actionIdentifier == "KOA_REPLY_ACTION",
           let textResponse = response as? UNTextInputNotificationResponse,
           !textResponse.userText.isEmpty
        {
            Task.detached {
                await KoaAPI.sendNotificationReply(message: textResponse.userText)
            }
        } else {
            let userInfo = response.notification.request.content.userInfo
            if let taskId = userInfo["taskId"] as? String {
                NotificationCenter.default.post(name: .openTask, object: taskId)
            }
        }
        handler()
    }
}

extension Notification.Name {
    static let apnsTokenRegistered = Notification.Name("apnsTokenRegistered")
    static let openTask = Notification.Name("openTask")
}

// MARK: - Main tab view

struct MainTabView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        TabView(selection: Bindable(state).selectedTab) {
            ChatView()
                .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                .tag(AppState.Tab.chat)

            TaskBoardView()
                .tabItem { Label("Board", systemImage: "checklist") }
                .tag(AppState.Tab.board)

            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(AppState.Tab.search)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppState.Tab.settings)
        }
    }
}
