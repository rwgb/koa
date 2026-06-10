import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
    @Environment(AppState.self) private var state
    @State private var isPushEnabled = false
    @State private var pushStatus = ""
    @State private var isRegistering = false
    @State private var watchPrompts: [String] = Array(repeating: "", count: 5)
    @State private var watchSyncStatus = ""

    private let appGroupID = "group.io.koa.shared"
    private let defaultPrompts = ["What's next?", "Any blockers?", "Summarize my day", "What's urgent?", "How am I doing?"]

    private var api: KoaAPI {
        KoaAPI(baseURL: state.serverURL, token: state.bearerToken)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    LabeledContent("URL", value: state.serverURL.isEmpty ? "Not set" : state.serverURL)
                    Button("Disconnect") {
                        state.serverURL = ""
                        state.bearerToken = ""
                        state.save()
                        state.isAuthenticated = false
                    }
                    .foregroundStyle(.red)
                }

                Section("Push Notifications") {
                    Toggle("Enable push", isOn: $isPushEnabled)
                        .onChange(of: isPushEnabled) { _, enabled in
                            handlePushToggle(enabled: enabled)
                        }
                    if !pushStatus.isEmpty {
                        Text(pushStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if isRegistering {
                        ProgressView("Registering…")
                    }
                }

                Section("Apple Watch") {
                    ForEach(0..<5, id: \.self) { i in
                        TextField("Prompt \(i + 1)", text: $watchPrompts[i])
                            .onChange(of: watchPrompts[i]) { saveWatchPrompts() }
                    }
                    Button("Sync credentials to Watch") {
                        WatchBridge.shared.syncCredentials(serverURL: state.serverURL, bearerToken: state.bearerToken)
                        watchSyncStatus = "Sent — open Apple Watch app to confirm."
                    }
                    if !watchSyncStatus.isEmpty {
                        Text(watchSyncStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                    LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                refreshPushStatus()
                loadWatchPrompts()
            }
            .onReceive(NotificationCenter.default.publisher(for: .apnsTokenRegistered)) { note in
                if let token = note.object as? String {
                    registerToken(token)
                }
            }
        }
    }

    private func refreshPushStatus() {
        let storedToken = UserDefaults.standard.string(forKey: AppDelegate.apnsTokenKey)
        isPushEnabled = storedToken != nil && !storedToken!.isEmpty
        pushStatus = isPushEnabled ? "Device token registered" : "Not registered"
    }

    private func handlePushToggle(enabled: Bool) {
        if enabled {
            requestPushPermission()
        } else {
            unregisterPush()
        }
    }

    private func requestPushPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                    pushStatus = "Requesting device token…"
                } else {
                    isPushEnabled = false
                    pushStatus = error?.localizedDescription ?? "Permission denied."
                }
            }
        }
    }

    private func registerToken(_ token: String) {
        isRegistering = true
        Task {
            do {
                try await api.registerApnsToken(token)
                await MainActor.run {
                    pushStatus = "Device token registered"
                    isRegistering = false
                }
            } catch {
                await MainActor.run {
                    pushStatus = "Registration failed: \(error.localizedDescription)"
                    isRegistering = false
                }
            }
        }
    }

    private func unregisterPush() {
        Task {
            try? await api.unregisterApnsToken()
            UserDefaults.standard.removeObject(forKey: AppDelegate.apnsTokenKey)
            await MainActor.run {
                pushStatus = "Not registered"
            }
        }
    }

    private func loadWatchPrompts() {
        let defaults = UserDefaults(suiteName: appGroupID)
        watchPrompts = (0..<5).map { i in
            defaults?.string(forKey: "watchPrompt_\(i)") ?? defaultPrompts[i]
        }
    }

    private func saveWatchPrompts() {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        for (i, prompt) in watchPrompts.enumerated() {
            defaults.set(prompt, forKey: "watchPrompt_\(i)")
        }
    }
}
