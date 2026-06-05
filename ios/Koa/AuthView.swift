import SwiftUI

struct AuthView: View {
    @Environment(AppState.self) private var state
    @State private var serverURL = ""
    @State private var bearerToken = ""
    @State private var isChecking = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("http://100.x.x.x:3000", text: $serverURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                }

                Section("Authentication") {
                    SecureField("Bearer token (leave blank if none)", text: $bearerToken)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }

                Section {
                    Button(action: connect) {
                        if isChecking {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Connect")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(serverURL.isEmpty || isChecking)
                }
            }
            .navigationTitle("Connect to Koa")
            .onAppear {
                serverURL = state.serverURL
                bearerToken = state.bearerToken
            }
        }
    }

    private func connect() {
        isChecking = true
        errorMessage = nil
        state.serverURL = serverURL
        state.bearerToken = bearerToken
        state.save()
        let api = KoaAPI(baseURL: serverURL, token: bearerToken)
        Task {
            do {
                try await api.ping()
                await MainActor.run { state.isAuthenticated = true }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isChecking = false
                }
            }
        }
    }
}
