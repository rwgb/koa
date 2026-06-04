import SwiftUI

struct WatchDictationView: View {
    @EnvironmentObject private var session: WatchSession
    @State private var inputText = ""
    @State private var responseText = ""
    @State private var isLoading = false
    @State private var showResponse = false

    var body: some View {
        if showResponse {
            responseView
        } else {
            inputView
        }
    }

    private var inputView: some View {
        VStack(spacing: 8) {
            Text("Ask Koa")
                .font(.headline)

            // On watchOS, TextField activates the dictation keyboard.
            TextField("Dictate message", text: $inputText)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .disabled(isLoading)

            Button("Send") { send() }
                .buttonStyle(.borderedProminent)
                .font(.caption)
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
        }
        .padding()
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
                Button("Back") {
                    showResponse = false
                    inputText = ""
                }
                .buttonStyle(.bordered)
                .font(.caption)
            }
            .padding()
        }
    }

    private func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isLoading = true
        Task {
            do {
                let response = try await session.sendChat(message: text)
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
