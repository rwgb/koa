import SwiftUI

// Reads non-sensitive glance data from the shared App Group defaults.
// Populated by the iOS app whenever a new assistant message arrives.
private let appGroupID = "group.io.koa.shared"

struct GlanceView: View {
    @State private var lastMessage = "—"
    @State private var openTaskCount = 0
    @State private var calendarCount = 0
    @State private var sessionCostToday = 0.0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Koa")
                    .font(.headline)

                Divider()

                GlanceRow(icon: "message.fill", label: lastMessage)
                GlanceRow(icon: "checklist", label: "\(openTaskCount) open tasks")
                GlanceRow(icon: "calendar", label: "\(calendarCount) events today")
                GlanceRow(icon: "dollarsign.circle", label: String(format: "$%.4f today", sessionCostToday))
            }
            .padding()
        }
        .onAppear(perform: refresh)
    }

    private func refresh() {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        lastMessage = defaults.string(forKey: "glance_lastMessage") ?? "—"
        openTaskCount = defaults.integer(forKey: "glance_openTaskCount")
        calendarCount = defaults.integer(forKey: "glance_calendarCount")
        sessionCostToday = defaults.double(forKey: "glance_sessionCostToday")
    }
}

private struct GlanceRow: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 16)
            Text(label)
                .font(.caption)
                .lineLimit(2)
        }
    }
}
