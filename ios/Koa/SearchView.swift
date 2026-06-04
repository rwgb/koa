import SwiftUI

struct SearchView: View {
    @Environment(AppState.self) private var state
    @State private var query = ""
    @State private var results: [KoaTask] = []
    @State private var isLoading = false
    @State private var searchTask: Task<Void, Never>? = nil

    private var api: KoaAPI {
        KoaAPI(baseURL: state.serverURL, token: state.bearerToken)
    }

    var body: some View {
        NavigationStack {
            VStack {
                TextField("Search tasks…", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)
                    .onChange(of: query) { _, newValue in
                        searchTask?.cancel()
                        if newValue.isEmpty {
                            results = []
                            return
                        }
                        searchTask = Task {
                            try? await Task.sleep(nanoseconds: 300_000_000)
                            guard !Task.isCancelled else { return }
                            await MainActor.run { isLoading = true }
                            do {
                                let found = try await api.search(query: newValue)
                                await MainActor.run {
                                    results = found
                                    isLoading = false
                                }
                            } catch {
                                await MainActor.run { isLoading = false }
                            }
                        }
                    }

                if isLoading {
                    ProgressView()
                        .padding()
                } else if !query.isEmpty && results.isEmpty {
                    ContentUnavailableView("No results", systemImage: "magnifyingglass")
                } else {
                    List(results) { task in
                        NavigationLink(destination: TaskDetailView(task: task, onUpdate: { _ in })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(task.title)
                                    .font(.body)
                                Text("\(task.projectId ?? "—")  ·  \(task.status.label)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .listStyle(.plain)
                }

                Spacer()
            }
            .navigationTitle("Search")
        }
    }
}
