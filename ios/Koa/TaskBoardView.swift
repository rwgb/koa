import SwiftUI

struct TaskBoardView: View {
    @Environment(AppState.self) private var state
    @State private var isLoading = false
    @State private var selectedTask: KoaTask?
    @State private var errorMessage: String?

    private var api: KoaAPI {
        KoaAPI(baseURL: state.serverURL, token: state.bearerToken)
    }

    private let columns: [TaskStatus] = [.todo, .inProgress, .done]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && state.tasks.isEmpty {
                    ProgressView("Loading…")
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(columns, id: \.self) { status in
                                KanbanColumn(
                                    status: status,
                                    tasks: state.tasks.filter { $0.status == status },
                                    onSelect: { selectedTask = $0 }
                                )
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Board")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: loadTasks) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(item: $selectedTask) { task in
                TaskDetailView(task: task, onUpdate: { updated in
                    if let idx = state.tasks.firstIndex(where: { $0.id == updated.id }) {
                        state.tasks[idx] = updated
                    }
                })
            }
            .task { loadTasks() }
        }
    }

    private func loadTasks() {
        isLoading = true
        Task {
            do {
                let tasks = try await api.fetchTasks()
                let projects = try await api.fetchProjects()
                await MainActor.run {
                    state.tasks = tasks
                    state.projects = projects
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }
}

// MARK: - Kanban column

private struct KanbanColumn: View {
    let status: TaskStatus
    let tasks: [KoaTask]
    let onSelect: (KoaTask) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(status.label)
                    .font(.headline)
                Spacer()
                Text("\(tasks.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)

            ForEach(tasks) { task in
                TaskCard(task: task)
                    .onTapGesture { onSelect(task) }
            }
        }
        .frame(width: 240)
        .padding(10)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Task card

private struct TaskCard: View {
    let task: KoaTask

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(task.title)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(2)
            if let deadline = task.deadline {
                Label(formatDate(deadline), systemImage: "calendar")
                    .font(.caption)
                    .foregroundStyle(isOverdue(deadline) ? .red : .secondary)
            }
            if let priority = task.priority, priority > 0 {
                HStack(spacing: 2) {
                    ForEach(0..<min(priority, 3), id: \.self) { _ in
                        Image(systemName: "exclamationmark")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }

    private func formatDate(_ iso: String) -> String {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withFullDate]
        guard let date = df.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter()
        out.dateStyle = .short
        return out.string(from: date)
    }

    private func isOverdue(_ iso: String) -> Bool {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withFullDate]
        guard let date = df.date(from: String(iso.prefix(10))) else { return false }
        return date < Date()
    }
}
