import Foundation
import WatchConnectivity

// Handles all Watch Connectivity on the iOS side.
// Keeps WCSession / NSObject outside AppState so the @Observable class stays clean.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()

    private let appGroupID = "group.io.koa.shared"

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // Call after the user authenticates or changes server settings.
    func syncCredentials(serverURL: String, bearerToken: String) {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated,
              WCSession.default.isPaired,
              WCSession.default.isWatchAppInstalled
        else { return }
        let context: [String: Any] = ["serverURL": serverURL, "bearerToken": bearerToken]
        try? WCSession.default.updateApplicationContext(context)
    }

    // Called from ChatView when an assistant message completes.
    func updateGlance(
        lastMessage: String,
        openTaskCount: Int = 0,
        calendarCount: Int = 0,
        sessionCostToday: Double = 0.0
    ) {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        defaults.set(String(lastMessage.prefix(80)), forKey: "glance_lastMessage")
        defaults.set(openTaskCount, forKey: "glance_openTaskCount")
        defaults.set(calendarCount, forKey: "glance_calendarCount")
        defaults.set(sessionCostToday, forKey: "glance_sessionCostToday")
    }

    // MARK: - WCSessionDelegate (required stubs)

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
