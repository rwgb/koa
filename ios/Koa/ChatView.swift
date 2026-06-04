import SwiftUI
import AVFoundation

struct ChatView: View {
    @Environment(AppState.self) private var state
    @State private var inputText = ""
    @State private var streamingContent = ""
    @State private var toolCallInProgress: String?
    @State private var scrollProxy: ScrollViewProxy?
    @State private var lastMessageId: UUID?
    @State private var isRecording = false
    @State private var audioRecorder: AVAudioRecorder?
    @State private var audioPlayer: AVAudioPlayer?
    private let speechSynthesizer = AVSpeechSynthesizer()

    private var api: KoaAPI {
        KoaAPI(baseURL: state.serverURL, token: state.bearerToken)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(state.messages) { msg in
                                MessageBubble(message: msg)
                                    .id(msg.id)
                            }
                            if let tool = toolCallInProgress {
                                HStack(spacing: 6) {
                                    ProgressView().scaleEffect(0.7)
                                    Text("Running \(tool)…")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.horizontal)
                            }
                        }
                        .padding()
                    }
                    .onAppear { scrollProxy = proxy }
                    .onChange(of: state.messages.count) {
                        scrollToBottom()
                    }
                }

                Divider()

                HStack(spacing: 10) {
                    Button(action: toggleRecording) {
                        Image(systemName: isRecording ? "mic.slash.fill" : "mic.fill")
                            .font(.title2)
                            .foregroundStyle(isRecording ? .red : (state.isAgentBusy ? .gray : .blue))
                    }
                    .disabled(state.isAgentBusy && !isRecording)

                    TextField("Message", text: $inputText, axis: .vertical)
                        .lineLimit(1...5)
                        .textFieldStyle(.roundedBorder)
                        .disabled(state.isAgentBusy)
                        .submitLabel(.send)
                        .onSubmit(sendMessage)

                    Button(action: sendMessage) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                            .foregroundStyle(inputText.isEmpty || state.isAgentBusy ? .gray : .blue)
                    }
                    .disabled(inputText.isEmpty || state.isAgentBusy)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .navigationTitle("Koa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if state.isAgentBusy {
                        ProgressView().scaleEffect(0.8)
                    }
                }
            }
        }
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !state.isAgentBusy else { return }
        inputText = ""
        state.messages.append(ChatMessage(role: .user, content: text))
        state.isAgentBusy = true

        guard let req = api.sseRequest(message: text) else {
            state.messages.append(ChatMessage(role: .system, content: "Invalid server URL."))
            state.isAgentBusy = false
            return
        }

        var assistantMsg = ChatMessage(role: .assistant, content: "", isStreaming: true)
        state.messages.append(assistantMsg)
        let msgIndex = state.messages.count - 1

        Task {
            var buffer = ""
            for await event in SseStream.open(req) {
                await MainActor.run {
                    switch event.type {
                    case "tool_call":
                        toolCallInProgress = event.name
                    case "tool_result":
                        toolCallInProgress = nil
                    case "content":
                        buffer = event.text ?? ""
                        assistantMsg.content = buffer
                        assistantMsg.agent = event.agent
                        state.messages[msgIndex] = assistantMsg
                    case "done":
                        assistantMsg.isStreaming = false
                        assistantMsg.agent = event.agent
                        state.messages[msgIndex] = assistantMsg
                        state.isAgentBusy = false
                        toolCallInProgress = nil
                        if !assistantMsg.content.isEmpty {
                            speakResponse(assistantMsg.content)
                        }
                    case "error":
                        assistantMsg.content = event.message ?? "Unknown error"
                        assistantMsg.isStreaming = false
                        state.messages[msgIndex] = assistantMsg
                        state.isAgentBusy = false
                        toolCallInProgress = nil
                    default:
                        break
                    }
                }
            }
            await MainActor.run {
                state.isAgentBusy = false
                toolCallInProgress = nil
            }
        }
    }

    private func toggleRecording() {
        if isRecording {
            stopRecordingAndTranscribe()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
        } catch {
            state.messages.append(ChatMessage(role: .system, content: "Microphone error: \(error.localizedDescription)"))
            return
        }

        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: tempURL, settings: settings)
            audioRecorder?.record()
            isRecording = true
        } catch {
            state.messages.append(ChatMessage(role: .system, content: "Recording error: \(error.localizedDescription)"))
        }
    }

    private func stopRecordingAndTranscribe() {
        guard let recorder = audioRecorder else { return }
        let fileURL = recorder.url
        recorder.stop()
        audioRecorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)

        Task {
            defer { try? FileManager.default.removeItem(at: fileURL) }
            do {
                let text = try await api.transcribeAudio(fileURL: fileURL)
                await MainActor.run {
                    inputText = text
                }
                // Auto-submit after transcription
                sendMessage()
            } catch {
                await MainActor.run {
                    state.messages.append(ChatMessage(role: .system, content: "Transcription failed: \(error.localizedDescription)"))
                }
            }
        }
    }

    private func speakResponse(_ text: String) {
        Task {
            do {
                let data = try await api.synthesizeAudio(text: text)
                await MainActor.run {
                    do {
                        audioPlayer = try AVAudioPlayer(data: data)
                        audioPlayer?.play()
                    } catch {
                        fallbackSpeak(text)
                    }
                }
            } catch {
                await MainActor.run { fallbackSpeak(text) }
            }
        }
    }

    private func fallbackSpeak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.52
        speechSynthesizer.speak(utterance)
    }

    private func scrollToBottom() {
        guard let last = state.messages.last else { return }
        withAnimation { scrollProxy?.scrollTo(last.id, anchor: .bottom) }
    }
}

// MARK: - Message bubble

private struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top) {
            if message.role == .user { Spacer(minLength: 60) }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                if let agent = message.agent, message.role == .assistant {
                    Text(agent)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                }
                Text(message.content.isEmpty ? "…" : message.content)
                    .padding(10)
                    .background(message.role == .user ? Color.blue : Color(.secondarySystemBackground))
                    .foregroundStyle(message.role == .user ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            if message.role != .user { Spacer(minLength: 60) }
        }
    }
}
