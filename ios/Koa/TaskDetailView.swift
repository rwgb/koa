import SwiftUI

struct TaskDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var state

    let task: KoaTask
    let onUpdate: (KoaTask) -> Void

    @State private var statusSelection: TaskStatus
    @State private var actualHoursText: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(task: KoaTask, onUpdate: @escaping (KoaTask) -> Void) {
        self.task = task
        self.onUpdate = onUpdate
        _statusSelection = State(initialValue: task.status)
        _actualHoursText = State(initialValue: task.actualHours.map { String($0) } ?? "")
    }

    private var api: KoaAPI {
        KoaAPI(baseURL: state.serverURL, token: state.bearerToken)
    }

    private var hasChanges: Bool {
        statusSelection != task.status || actualHoursText != (task.actualHours.map { String($0) } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    Text(task.title)
                        .font(.headline)
                    if let desc = task.description, !desc.isEmpty {
                        Text(desc)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Details") {
                    if let deadline = task.deadline {
                        LabeledContent("Deadline", value: formatDate(deadline))
                    }
                    if let effort = task.effort {
                        LabeledContent("Effort", value: effort)
                    }
                    if let priority = task.priority {
                        LabeledContent("Priority", value: "\(priority)")
                    }
                }

                Section("Status") {
                    Picker("Status", selection: $statusSelection) {
                        ForEach(TaskStatus.allCases, id: \.self) { s in
                            Text(s.label).tag(s)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Time Tracking") {
                    HStack {
                        Text("Actual hours")
                        Spacer()
                        TextField("e.g. 2.5", text: $actualHoursText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }
            }
            .navigationTitle("Task Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(isSaving || !hasChanges)
                }
            }
        }
    }

    private func save() {
        isSaving = true
        var updates: [String: Any] = ["status": statusSelection.rawValue]
        if let hours = Double(actualHoursText), !actualHoursText.isEmpty {
            updates["actual_hours"] = hours
        } else if actualHoursText.isEmpty && task.actualHours != nil {
            updates["actual_hours"] = NSNull()
        }
        Task {
            do {
                let updated = try await api.updateTask(taskId: task.id, updates: updates)
                await MainActor.run {
                    onUpdate(updated)
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isSaving = false
                }
            }
        }
    }

    private func formatDate(_ iso: String) -> String {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withFullDate]
        guard let date = df.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: date)
    }
}
