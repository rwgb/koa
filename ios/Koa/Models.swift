import Foundation

// MARK: - Task

struct KoaTask: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var description: String?
    var status: TaskStatus
    var priority: Int?
    var deadline: String?
    var effort: String?
    var actualHours: Double?
    var projectId: String?
    let createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, description, status, priority, deadline, effort
        case actualHours = "actual_hours"
        case projectId = "project_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum TaskStatus: String, Codable, CaseIterable {
    case backlog, todo, inProgress = "in_progress", done, cancelled

    var label: String {
        switch self {
        case .backlog: return "Backlog"
        case .todo: return "Todo"
        case .inProgress: return "In Progress"
        case .done: return "Done"
        case .cancelled: return "Cancelled"
        }
    }
}

// MARK: - Project

struct KoaProject: Codable, Identifiable {
    let id: String
    var name: String
    var description: String?
    var status: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, description, status
        case createdAt = "created_at"
    }
}

// MARK: - Chat

struct ChatMessage: Identifiable {
    let id = UUID()
    var role: MessageRole
    var content: String
    var agent: String?
    var isStreaming: Bool = false
}

enum MessageRole {
    case user, assistant, system
}

struct SseEvent: Decodable {
    let type: String
    let text: String?
    let message: String?
    let name: String?
    let result: String?
    let agent: String?
    let tier: String?
    let model: String?
    let turnCount: Int?
}

// MARK: - Usage

struct UsageResponse: Codable {
    let inputTokens: Int
    let outputTokens: Int
    let cacheWriteTokens: Int?
    let cacheReadTokens: Int?
    let estimatedCostUsd: Double?

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheWriteTokens = "cache_write_tokens"
        case cacheReadTokens = "cache_read_tokens"
        case estimatedCostUsd = "estimated_cost_usd"
    }
}
