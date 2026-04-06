import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Send, Bot, User, ChevronDown, Zap } from 'lucide-react'

const PROJECT_ID = 'demo'
const API_BASE = 'http://localhost:8000'

type QueryType =
  | 'general'
  | 'debug'
  | 'search_parts'
  | 'extract_values'
  | 'impact_analysis'
  | 'plan'

type FlashState = 'idle' | 'compiling' | 'uploading' | 'done' | 'error'
type SystemMsgType = 'log' | 'success' | 'error' | 'info'

const QUERY_TYPE_LABELS: Record<QueryType, string> = {
  general: 'General',
  debug: 'Debug',
  search_parts: 'Search Parts',
  extract_values: 'Extract Values',
  impact_analysis: 'Impact Analysis',
  plan: 'Plan',
}

interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  queryType?: QueryType
  timestamp: Date
  error?: boolean
  systemType?: SystemMsgType
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-solus-accent-bright/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

function extractArduinoCode(text: string): string[] {
  const codeBlockRegex = /```(?:cpp|arduino|c)?\n([\s\S]*?)```/g
  const blocks: string[] = []
  let match
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const code = match[1].trim()
    if (
      code.includes('void setup()') ||
      code.includes('void loop()') ||
      code.includes('#include') ||
      code.includes('Serial.begin')
    ) {
      blocks.push(code)
    }
  }
  return blocks
}

function formatContent(content: string): React.ReactNode {
  const parts = content.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const lines = part.slice(3, -3).split('\n')
      const lang = lines[0].trim()
      const code = (lang && !/\s/.test(lang) ? lines.slice(1) : lines).join('\n')
      return (
        <pre
          key={i}
          className="bg-solus-bg border border-solus-border rounded p-3 text-xs font-mono text-solus-text-dim overflow-x-auto my-2"
        >
          {code}
        </pre>
      )
    }

    const segments = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return (
      <span key={i}>
        {segments.map((seg, j) => {
          if (seg.startsWith('**') && seg.endsWith('**')) {
            return (
              <strong key={j} className="font-semibold text-solus-text">
                {seg.slice(2, -2)}
              </strong>
            )
          }
          if (seg.startsWith('`') && seg.endsWith('`')) {
            return (
              <code key={j} className="bg-solus-bg text-solus-accent-bright font-mono text-xs px-1 rounded">
                {seg.slice(1, -1)}
              </code>
            )
          }
          return seg.split('\n').map((line, k, arr) => (
            <span key={k}>
              {line}
              {k < arr.length - 1 && <br />}
            </span>
          ))
        })}
      </span>
    )
  })
}

function SystemBanner({ message }: { message: Message }) {
  const styleMap: Record<SystemMsgType, string> = {
    log: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-200',
    success: 'bg-green-500/10 border-green-500/30 text-green-200',
    error: 'bg-red-500/10 border-red-500/30 text-red-300',
    info: 'bg-solus-accent/10 border-solus-accent/30 text-solus-text-dim',
  }
  const type = message.systemType ?? 'info'

  return (
    <div className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${styleMap[type]}`}>
      <div className="whitespace-pre-wrap">{message.content}</div>
      <div className="text-[10px] opacity-50 mt-1">
        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  flashState,
  onFlash,
  arduinoAvailable,
}: {
  message: Message
  flashState: FlashState
  onFlash: (code: string) => void
  arduinoAvailable: boolean
}) {
  if (message.role === 'system') {
    return <SystemBanner message={message} />
  }

  const isUser = message.role === 'user'
  const arduinoBlocks = !isUser ? extractArduinoCode(message.content) : []

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 ${
          isUser
            ? 'bg-solus-accent/30 text-solus-accent-bright'
            : 'bg-solus-elevated text-solus-text-dim border border-solus-border'
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[75%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {message.queryType && !isUser && (
          <span className="text-xs font-mono text-solus-text-muted px-1">
            [{QUERY_TYPE_LABELS[message.queryType]}]
          </span>
        )}
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-solus-accent text-white rounded-tr-sm'
              : message.error
              ? 'bg-solus-error/10 border border-solus-error/30 text-solus-error rounded-tl-sm'
              : 'bg-solus-elevated border border-solus-border text-solus-text rounded-tl-sm'
          }`}
        >
          {isUser ? message.content : formatContent(message.content)}

          {/* Flash button for detected Arduino code */}
          {arduinoBlocks.length > 0 && (
            <div className="mt-3 border-t border-solus-border pt-3">
              {arduinoAvailable ? (
                <>
                  <div className="text-xs text-solus-text-muted mb-2 font-mono">
                    Arduino code detected — flash to robot?
                  </div>
                  {arduinoBlocks.map((code, i) => (
                    <button
                      key={i}
                      onClick={() => onFlash(code)}
                      disabled={flashState !== 'idle'}
                      className="bg-solus-accent hover:bg-solus-accent/80 text-white px-3 py-1.5 rounded text-xs font-mono disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      <Zap size={12} />
                      {flashState === 'idle' && 'Flash Fix to Robot'}
                      {flashState === 'compiling' && 'Compiling...'}
                      {flashState === 'uploading' && 'Uploading...'}
                      {flashState === 'done' && 'Flashed!'}
                      {flashState === 'error' && 'Flash Failed'}
                    </button>
                  ))}
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-solus-text-muted font-mono">
                    arduino-cli not installed — flash manually via Arduino IDE
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(arduinoBlocks[0])}
                    className="text-xs font-mono px-2 py-1.5 bg-solus-elevated border border-solus-border text-solus-text-dim rounded hover:bg-solus-border transition-colors"
                  >
                    Copy code to clipboard
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-solus-text-muted px-1 font-mono">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ─── Demo constants ───────────────────────────────────────────────────────────

const FIXED_ARDUINO_CODE = `#include <Servo.h>
#define PWMA 5
#define AIN1 7
#define PWMB 6
#define BIN1 8
#define STBY 3
#define TRIG 13
#define ECHO 12
#define SERVO_PIN 10
Servo headServo;
bool robotRunning = false;
bool bugEnabled = false;
float KP = 2.0, KD = 0.5;
float BUG_KP = 50.0, BUG_KD = 0.0;
float pidError = 0, pidLastError = 0;
int leftPWM = 0, rightPWM = 0;
unsigned long lastSend = 0;
void setup() {
  Serial.begin(9600);
  pinMode(PWMA, OUTPUT); pinMode(AIN1, OUTPUT);
  pinMode(PWMB, OUTPUT); pinMode(BIN1, OUTPUT);
  pinMode(STBY, OUTPUT);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  headServo.attach(SERVO_PIN); headServo.write(90);
  digitalWrite(STBY, HIGH);
  analogWrite(PWMA, 0); analogWrite(PWMB, 0);
}
long readDistance() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long d = pulseIn(ECHO, HIGH, 30000);
  return d == 0 ? -1 : d * 0.034 / 2;
}
void driveMotors(int left, int right) {
  if (left >= 0) { digitalWrite(AIN1, HIGH); analogWrite(PWMA, constrain(left, 0, 255)); }
  else { digitalWrite(AIN1, LOW); analogWrite(PWMA, constrain(-left, 0, 255)); }
  if (right >= 0) { digitalWrite(BIN1, HIGH); analogWrite(PWMB, constrain(right, 0, 255)); }
  else { digitalWrite(BIN1, LOW); analogWrite(PWMB, constrain(-right, 0, 255)); }
}
void handleCommands() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\\n'); cmd.trim();
  if (cmd == "START") { robotRunning = true; }
  else if (cmd == "STOP") { robotRunning = false; driveMotors(0,0); leftPWM=0; rightPWM=0; pidError=0; pidLastError=0; }
  else if (cmd == "SWEEP") { headServo.write(0); delay(300); headServo.write(180); delay(300); headServo.write(90); }
}
void loop() {
  handleCommands();
  long dist = readDistance();
  if (robotRunning && dist > 0 && dist < 100) {
    float kp = KP;
    float kd = KD;
    pidError = dist - 25.0;
    float output = kp * pidError + kd * (pidError - pidLastError);
    pidLastError = pidError;
    leftPWM = constrain(120 + (int)output, -255, 255);
    rightPWM = constrain(120 - (int)output, -255, 255);
    driveMotors(leftPWM, rightPWM);
  } else if (robotRunning) {
    leftPWM = 120; rightPWM = 120; driveMotors(120, 120);
  } else {
    leftPWM = 0; rightPWM = 0; driveMotors(0, 0);
  }
  if (millis() - lastSend >= 100) {
    lastSend = millis();
    Serial.print(F("{\\"signals\\":["));
    Serial.print(F("{\\"name\\":\\"distance_cm\\",\\"value\\":")); Serial.print(dist);
    Serial.print(F(",\\"unit\\":\\"cm\\"},"));
    Serial.print(F("{\\"name\\":\\"left_motor\\",\\"value\\":")); Serial.print(leftPWM/255.0, 3);
    Serial.print(F(",\\"unit\\":\\"norm\\"},"));
    Serial.print(F("{\\"name\\":\\"right_motor\\",\\"value\\":")); Serial.print(rightPWM/255.0, 3);
    Serial.print(F(",\\"unit\\":\\"norm\\"},"));
    Serial.print(F("{\\"name\\":\\"pid_error\\",\\"value\\":")); Serial.print(pidError, 2);
    Serial.print(F(",\\"unit\\":\\"\\"},"));
    Serial.print(F("{\\"name\\":\\"kp_value\\",\\"value\\":")); Serial.print(KP, 1);
    Serial.print(F(",\\"unit\\":\\"\\"},"));
    Serial.print(F("{\\"name\\":\\"kd_value\\",\\"value\\":")); Serial.print(KD, 1);
    Serial.print(F(",\\"unit\\":\\"\\"},"));
    Serial.print(F("{\\"name\\":\\"running\\",\\"value\\":")); Serial.print(robotRunning ? 1 : 0);
    Serial.print(F(",\\"unit\\":\\"\\"},"));
    Serial.print(F("{\\"name\\":\\"bug_active\\",\\"value\\":0,\\"unit\\":\\"\\"}"));
    Serial.println(F("]}"));
  }
  delay(10);
}`

const DEMO_DIAGNOSIS = `**LIKELY CAUSE:**
The motor oscillation is caused by an overly aggressive PID proportional gain. The current code has KP=50.0 and KD=0.0.

With KP=50, a 5 cm deviation from the target distance produces a motor output of 250 (nearly full speed), causing the robot to overcorrect. On the next cycle it overcorrects in the opposite direction, creating the oscillation pattern visible in the telemetry.

Additionally, KD=0.0 means there is no derivative damping to resist rapid changes, making the oscillation worse.

**SUGGESTED FIX:**
Set KP=2.0 and KD=0.5. This gives proportional response without overcorrection, and the derivative term resists sudden changes to stabilize the motors.

Here is the corrected Arduino code:

\`\`\`cpp
${FIXED_ARDUINO_CODE}
\`\`\``

export default function AgentTab() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      content:
        "Hello! I'm the Solus AI agent. I can help you debug robot behavior, search for parts, analyze system impact, extract values from documents, and more. What would you like to explore?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [queryType, setQueryType] = useState<QueryType>('general')
  const [loading, setLoading] = useState(false)
  const [flashState, setFlashState] = useState<FlashState>('idle')
  const [arduinoAvailable, setArduinoAvailable] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Check arduino-cli availability on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/arduino/available`)
      .then((r) => r.json())
      .then((data) => setArduinoAvailable(data.available))
      .catch(() => setArduinoAvailable(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (overrideText?: string, overrideQueryType?: QueryType) => {
    const text = (overrideText ?? input).trim()
    const qtype = overrideQueryType ?? queryType
    if (!text || loading) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      queryType: qtype,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    if (!overrideText) setInput('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/api/projects/${PROJECT_ID}/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, query_type: qtype }),
      })

      let agentContent: string
      if (res.ok) {
        const data = await res.json()
        agentContent =
          data.response ||
          data.answer ||
          data.result ||
          data.content ||
          JSON.stringify(data, null, 2)
      } else {
        const err = await res.text().catch(() => res.statusText)
        agentContent = `Error ${res.status}: ${err}`
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          content: agentContent,
          queryType: qtype,
          timestamp: new Date(),
          error: !res.ok,
        },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          content: `Failed to reach the agent backend. Is it running?\n\n${String(err)}`,
          timestamp: new Date(),
          error: true,
        },
      ])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // Hardcoded demo diagnosis — fires instead of real backend when logs arrive from Live Bench
  const showDemoResponse = useCallback(async () => {
    setLoading(true)
    await new Promise<void>(resolve => setTimeout(resolve, 2000))
    setLoading(false)
    setMessages(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'agent' as const,
        content: DEMO_DIAGNOSIS,
        queryType: 'debug' as QueryType,
        timestamp: new Date(),
      },
    ])
  }, [])

  // Poll localStorage for pending Live Bench context
  useEffect(() => {
    const checkPendingContext = () => {
      const raw = window.localStorage.getItem('solus_agent_context')
      if (!raw) return

      try {
        const context = JSON.parse(raw)
        if (Date.now() - context.timestamp > 60000) return

        window.localStorage.removeItem('solus_agent_context')

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            systemType: 'log',
            content: `📋 Telemetry logs received from Live Bench:\n\n${context.logs.summary}`,
            timestamp: new Date(),
          },
        ])

        setQueryType('debug')
        showDemoResponse()
      } catch (e) {
        console.error('Failed to parse agent context:', e)
      }
    }

    checkPendingContext()
    const interval = setInterval(checkPendingContext, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFlash = async (code: string) => {
    setFlashState('compiling')

    try {
      const response = await fetch(`${API_BASE}/api/arduino/flash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'solus_fix',
          code,
          port: '',
          fqbn: 'arduino:avr:uno',
        }),
      })

      const result = await response.json()

      if (result.stage === 'compile' && !result.success) {
        setFlashState('error')
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            systemType: 'error',
            content: `❌ Compile error:\n\`\`\`\n${result.errors}\n\`\`\``,
            timestamp: new Date(),
          },
        ])
        setTimeout(() => setFlashState('idle'), 3000)
        return
      }

      if (result.success) {
        setFlashState('done')
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            systemType: 'success',
            content: '✅ Code flashed successfully! Switch to Live Bench and click Reconnect to see the fix in action.',
            timestamp: new Date(),
          },
        ])
        setTimeout(() => setFlashState('idle'), 5000)
      } else {
        setFlashState('error')
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            systemType: 'error',
            content: `❌ Upload failed:\n${result.errors || result.output || 'Unknown error'}`,
            timestamp: new Date(),
          },
        ])
        setTimeout(() => setFlashState('idle'), 3000)
      }
    } catch (e) {
      setFlashState('error')
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system',
          systemType: 'error',
          content: `❌ Flash error: ${(e as Error).message}`,
          timestamp: new Date(),
        },
      ])
      setTimeout(() => setFlashState('idle'), 3000)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="h-full flex flex-col bg-solus-bg">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 bg-solus-surface border-b border-solus-border">
        <Bot size={16} className="text-solus-accent-bright" />
        <span className="text-sm font-semibold text-solus-text">Solus Agent</span>
        <span className="ml-auto text-xs text-solus-text-muted font-mono">project: {PROJECT_ID}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            flashState={flashState}
            onFlash={handleFlash}
            arduinoAvailable={arduinoAvailable}
          />
        ))}

        {loading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-solus-elevated border border-solus-border text-solus-text-dim">
              <Bot size={14} />
            </div>
            <div className="bg-solus-elevated border border-solus-border rounded-2xl rounded-tl-sm px-3.5 py-2.5">
              <LoadingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-solus-border bg-solus-surface p-3 flex flex-col gap-2">
        {/* Query type selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-solus-text-muted">Type:</span>
          <div className="relative">
            <select
              value={queryType}
              onChange={(e) => setQueryType(e.target.value as QueryType)}
              className="appearance-none bg-solus-elevated border border-solus-border text-solus-text text-xs rounded px-2 py-1 pr-6 cursor-pointer"
            >
              {(Object.keys(QUERY_TYPE_LABELS) as QueryType[]).map((t) => (
                <option key={t} value={t}>
                  {QUERY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <ChevronDown
              size={10}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-solus-text-muted pointer-events-none"
            />
          </div>
          <span className="text-xs text-solus-text-muted ml-auto">Shift+Enter for newline</span>
        </div>

        {/* Text input + send */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask the agent (${QUERY_TYPE_LABELS[queryType].toLowerCase()})…`}
            rows={2}
            className="flex-1 bg-solus-elevated border border-solus-border rounded-lg px-3 py-2 text-sm text-solus-text placeholder:text-solus-text-muted resize-none focus:outline-none focus:border-solus-accent/60 transition-colors font-sans"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-solus-accent hover:bg-solus-accent/80 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
