import SwiftUI

private let appGroupID = "group.io.koa.shared"

private let defaultPrompts = [
    "What's next?",
    "Any blockers?",
    "Summarize my day",
    "What's urgent?",
    "How am I doing?",
]

struct QuickPromptsView: View {
    @EnvironmentObject private var session: WatchSession
    @State private var prompts: [String] = []
    @State private var responseText = ""
    @State private var isLoading = false
    @State private var showResponse = false

    var body: some View {
        if showResponse {
            responseView
        } else {
            promptListView
        }
    }

    private var promptListView: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text("Quick Prompts")
                    .font(.headline)
                    .padding(.bottom, 4)

                ForEach(prompts.indices, id: \.self) { i in
                    Button(prompts[i]) {
                        send(prompts[i])
                    }
                    .buttonStyle(.bordered)
                    .font(.caption)
                    .disabled(isLoading)
                }
            }
            .padding()
        }
        .onAppear(perform: loadPrompts)
        .overlay {
            if isLoading {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Asking Koa…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.regularMaterial)
            }
        }
    }

    private var responseView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(responseText)
                    .font(.caption)
                Button("Back") { showResponse = false }
                    .buttonStyle(.bordered)
                    .font(.caption)
            }
            .padding()
        }
    }

    private func loadPrompts() {
        let defaults = UserDefaults(suiteName: appGroupID)
        prompts = (0..<5).map { i in
            defaults?.string(forKey: "watchPrompt_\(i)") ?? defaultPrompts[i]
        }
    }

    private func send(_ prompt: String) {
        isLoading = true
        Task {
            do {
                let response = try await session.sendChat(message: prompt)
                await MainActor.run {
                    responseText = String(response.prefix(200))
                    isLoading = false
                    showResponse = true
                }
            } catch {
                await MainActor.run {
                    responseText = error.localizedDescription
                    isLoading = false
                    showResponse = true
                }
            }
        }
    }
}
