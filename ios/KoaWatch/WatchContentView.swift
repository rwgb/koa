import SwiftUI

struct WatchContentView: View {
    @EnvironmentObject private var session: WatchSession

    var body: some View {
        if session.isConfigured {
            TabView {
                GlanceView()
                QuickPromptsView()
                WatchDictationView()
            }
            .tabViewStyle(.page)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "iphone.and.arrow.forward")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("Open Koa on iPhone to sync credentials.")
                    .font(.caption2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }
}
