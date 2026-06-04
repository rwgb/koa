import Foundation

// SSE streaming via AsyncStream<SseEvent>.
// Usage:
//   if let req = api.sseRequest(message: "hello") {
//       for await event in SseStream.open(req) { ... }
//   }
enum SseStream {
    static func open(_ request: URLRequest) -> AsyncStream<SseEvent> {
        AsyncStream { continuation in
            Task {
                do {
                    let (bytes, _) = try await URLSession.shared.bytes(for: request)
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let json = String(line.dropFirst(6))
                        guard
                            let data = json.data(using: .utf8),
                            let event = try? JSONDecoder().decode(SseEvent.self, from: data)
                        else { continue }
                        continuation.yield(event)
                        if event.type == "done" || event.type == "error" { break }
                    }
                } catch { /* stream closed or network error — finish cleanly */ }
                continuation.finish()
            }
        }
    }
}
