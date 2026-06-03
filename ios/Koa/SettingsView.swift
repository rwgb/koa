import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
    @Environment(AppState.self) private var state
    @State private var isPushEnabled = false
    @State private var pushStatus = ""
    @State private var isRegistering = false

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

                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                    LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
            .onAppear(perform: refreshPushStatus)
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
}
