# 02 — opencodex 마스터 플랜

> 작성: 2026-06-18 · 프로젝트: opencodex (`ocx`)
> Interview 결과 기반 전체 로드맵 + Phase 1 상세 계획

## 프로젝트 한 줄 요약

Codex CLI/App/SDK가 OpenAI 외의 모든 LLM 프로바이더를 사용할 수 있게 하는 로컬 프록시 서버.

## 기술 결정 사항

| 항목 | 결정 |
|------|------|
| 이름 | opencodex (패키지), `ocx` (CLI) |
| 런타임 | Bun only |
| 라이선스 | MIT |
| 설정 | `~/.opencodex/config.json` + Codex `config.toml` 자동 주입 |
| 포트 | 10100 (기본) |
| GUI | 풀 React 대시보드 (Phase 5) |
| 아키텍처 | Plugin Adapter (코어 + 교체 가능한 프로바이더 어댑터) |
| jawcode 추출 | 추출 후 리팩토링 (외부 의존성 제거, 독립화) |
| 프로토콜 | 인바운드: `/v1/responses` (Codex 고정) → 아웃바운드: 각 프로바이더 네이티브 |

## 전체 로드맵 (7 Phase, 각 독립 PABCD)

```
P1 Core Proxy ──→ P2 Multi-Adapter ──→ P3 Config & Init ──→ P4 Model Router
                                                                    │
P7 Publish ←── P6 Enterprise ←── P5 React GUI ←────────────────────┘
```

---

## Phase 1: Core Proxy (이번 PABCD)

### 목표
Codex CLI → opencodex → opencode-go 경로로 코드 생성이 동작하는 최소 프록시.

### Done 기준
1. `ocx start` → 프록시 서버 localhost:10100에서 대기
2. Codex CLI에서 `model_provider = "opencodex"` 설정 후 프롬프트 전송
3. opencode-go의 Chat Completions 모델(예: `kimi-k2.5`)로 응답이 정상 스트리밍
4. `ocx stop` → 프록시 정상 종료

### 파일 구조

```
opencodex/
├── package.json                          ← MODIFY (scripts, dependencies)
├── tsconfig.json                         ← NEW
├── src/
│   ├── index.ts                          ← NEW (엔트리, Bun.serve)
│   ├── cli.ts                            ← NEW (ocx start/stop 명령)
│   ├── config.ts                         ← NEW (config.json 로드/저장)
│   ├── types.ts                          ← NEW (내부 Context, Message, Tool 타입)
│   ├── server.ts                         ← NEW (HTTP 서버 + /v1/responses 라우팅)
│   ├── responses/
│   │   ├── parser.ts                     ← NEW (Responses API → 내부 Context 변환)
│   │   ├── encoder.ts                    ← NEW (내부 이벤트 → Responses SSE 변환)
│   │   └── schema.ts                     ← NEW (Responses API Zod 스키마)
│   └── adapters/
│       ├── base.ts                       ← NEW (어댑터 인터페이스)
│       └── openai-chat.ts               ← NEW (Chat Completions 어댑터 — Tier 1)
├── devlog/
│   ├── 00_provider_audit.md              ← 기존 (변경 없음)
│   ├── 01_architecture_options.md        ← 기존 (변경 없음)
│   └── 02_master_plan.md                 ← NEW (이 파일)
└── .gitignore                            ← 기존 (변경 없음)
```

### 상세 설계

#### 1. `src/types.ts` — 내부 타입 (jawcode Context 경량화)

```typescript
// jawcode의 Context/Message/Tool을 경량화한 내부 표현
export interface OcxContext {
  systemPrompt: string[];
  messages: OcxMessage[];
  tools: OcxTool[];
}

export interface OcxMessage {
  role: "user" | "assistant" | "developer";
  content: string | OcxContentPart[];
  timestamp: number;
}

export interface OcxContentPart {
  type: "text" | "thinking" | "toolCall" | "toolResult";
  // ... 각 타입별 필드
}

export interface OcxTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AdapterResponse {
  type: "text" | "thinking" | "toolCall" | "done" | "error";
  // ... 이벤트별 필드
}
```

#### 2. `src/responses/parser.ts` — jawcode openai-responses-server.ts에서 추출

jawcode `parseRequest()` (266-474행)을 추출 + 리팩토링:
- `@jawcode-dev/utils` logger → console.log 또는 자체 logger
- `AuthGatewayParsedRequest` → `OcxContext`
- Zod 스키마는 `schema.ts`로 분리

핵심 변환: Responses API input items → OcxMessage[]
- `type: "message"` + `role: "user"` → `{ role: "user", content }`
- `type: "message"` + `role: "system"` → `systemPrompt[]`
- `type: "function_call"` → `{ type: "toolCall", ... }`
- `type: "function_call_output"` → `{ type: "toolResult", ... }`
- `type: "reasoning"` → `{ type: "thinking", ... }`

#### 3. `src/responses/encoder.ts` — jawcode encodeStream() 추출

jawcode `encodeStream()` (720-900행)을 추출:
- `ReadableStream<Uint8Array>` SSE 스트림 생성
- 이벤트 taxonomy: `response.created`, `response.output_item.added`,
  `response.output_text.delta`, `response.output_item.done`, `response.completed`
- `crypto.randomUUID()` → Bun 네이티브

#### 4. `src/adapters/base.ts` — 어댑터 인터페이스

```typescript
export interface ProviderAdapter {
  name: string;

  // 내부 Context → 프로바이더 네이티브 요청 빌드
  buildRequest(ctx: OcxContext, opts: AdapterOptions): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };

  // 프로바이더 SSE 스트림 → 내부 이벤트 스트림
  parseStream(response: Response): AsyncGenerator<AdapterResponse>;
}
```

#### 5. `src/adapters/openai-chat.ts` — Chat Completions 어댑터

Phase 1의 핵심. OcxContext를 Chat Completions 포맷으로 변환:

```
OcxContext.systemPrompt → messages[0] = { role: "system", content: joined }
OcxContext.messages → messages[1..N] (role/content 매핑)
OcxContext.tools → tools[] (function definition 변환)
toolCall → tool_calls[] (function_call 변환)
toolResult → { role: "tool", tool_call_id, content }
```

응답 파싱:
```
SSE: data: {"choices":[{"delta":{"content":"..."}}]}
  → { type: "text", text: "..." }
SSE: data: {"choices":[{"delta":{"tool_calls":[...]}}]}
  → { type: "toolCall", name, arguments }
SSE: data: [DONE]
  → { type: "done" }
```

#### 6. `src/server.ts` — HTTP 서버

```typescript
// Bun.serve로 HTTP 서버
// POST /v1/responses → parseRequest → adapter.buildRequest → fetch → adapter.parseStream → encodeStream
// GET /healthz → { status: "ok", version }
```

#### 7. `src/cli.ts` — `ocx` CLI

Phase 1에서는 최소:
- `ocx start` — 프록시 서버 시작 (포그라운드 또는 데몬)
- `ocx stop` — 프록시 서버 종료
- `ocx status` — 실행 상태 확인

#### 8. `src/config.ts` — 설정 관리

```json
// ~/.opencodex/config.json
{
  "port": 10100,
  "providers": {
    "opencode-go": {
      "adapter": "openai-chat",
      "baseUrl": "https://opencode.ai/zen/go/v1",
      "apiKey": "${OPENCODE_TOKEN}",
      "defaultModel": "kimi-k2.5"
    }
  },
  "defaultProvider": "opencode-go"
}
```

---

## Phase 2: Multi-Adapter (별도 PABCD)

### 목표
Anthropic Messages API + Google Generative AI 어댑터 추가.

### 파일 추가
```
src/adapters/
├── anthropic.ts              ← NEW (anthropic-messages-server.ts 추출)
├── google.ts                 ← NEW (google 변환 로직)
└── openai-responses.ts       ← NEW (패스스루 — OpenAI 네이티브)
```

### Done 기준
- Codex → ocx → Anthropic Claude 직접 호출 성공
- Codex → ocx → Google Gemini 호출 성공
- Codex → ocx → OpenAI 패스스루 성공

---

## Phase 3: Config & Init (별도 PABCD)

### 목표
`ocx init` 대화형 설정 + Codex config.toml 자동 주입.

### 파일 추가/수정
```
src/
├── cli.ts                    ← MODIFY (init, config 서브커맨드 추가)
├── init.ts                   ← NEW (대화형 init 워크플로우)
└── codex-inject.ts           ← NEW (config.toml 파싱 + [model_providers] 주입)
```

### Done 기준
- `ocx init` 실행 → 프로바이더 선택 → config.json 생성 → config.toml 자동 수정
- Codex를 별도 설정 없이 바로 사용 가능

---

## Phase 4: Model Router (별도 PABCD)

### 목표
모델 ID → 프로바이더 자동 라우팅 + 폴백 체인.

### 파일 추가
```
src/
├── router.ts                 ← NEW (모델 ID → 어댑터 라우팅 로직)
└── models.json               ← NEW (모델 ID → 프로바이더 매핑 레지스트리)
```

### Done 기준
- `model=claude-sonnet-4` 입력 시 자동으로 Anthropic 어댑터 선택
- 설정된 프로바이더 중 사용 가능한 것으로 폴백

---

## Phase 5: React GUI (별도 PABCD)

### 목표
`ocx gui` → 풀 React 대시보드.

### 파일 추가
```
gui/
├── package.json              ← NEW (Vite + React)
├── vite.config.ts            ← NEW
├── src/
│   ├── App.tsx               ← NEW
│   ├── pages/
│   │   ├── Dashboard.tsx     ← NEW (프록시 상태, 실시간 메트릭)
│   │   ├── Providers.tsx     ← NEW (프로바이더 CRUD, OAuth 로그인)
│   │   ├── Logs.tsx          ← NEW (실시간 요청/응답 로그)
│   │   └── Settings.tsx      ← NEW (config.json 편집, Codex 연동)
│   └── ...
└── dist/                     ← BUILD (빌드 후 서버에서 정적 serve)
```

### Done 기준
- `ocx gui` → 브라우저 열림, 프로바이더 추가/삭제/수정
- 실시간 요청 로그 스트리밍
- OAuth 로그인 플로우 (ocx login 대신 GUI에서)

---

## Phase 6: Enterprise Adapters (별도 PABCD)

### 목표
AWS Bedrock, Google Vertex, Azure OpenAI 어댑터.

### 파일 추가
```
src/adapters/
├── bedrock.ts                ← NEW (SigV4 + EventStream)
├── vertex.ts                 ← NEW (Google OAuth + Vertex)
└── azure.ts                  ← NEW (Azure OpenAI Responses)
```

### Done 기준
- 각 엔터프라이즈 프로바이더 1개 모델 연동 성공

---

## Phase 7: Polish & Publish (별도 PABCD)

### 목표
npm/bunx 배포, README, CI/CD, 커뮤니티 준비.

### 파일 추가/수정
```
├── README.md                 ← NEW (설치, 퀵스타트, 설정 가이드)
├── CONTRIBUTING.md           ← NEW
├── .github/workflows/ci.yml  ← NEW
├── bin/ocx                   ← NEW (npm bin 엔트리)
└── package.json              ← MODIFY (npm publish 준비)
```

### Done 기준
- `bunx opencodex` 또는 `npx opencodex`로 즉시 실행 가능
- GitHub README에 퀵스타트 3줄 가이드
- CI 통과

---

## Phase 1 jawcode 추출 매핑

| jawcode 소스 | 줄 수 | opencodex 대상 | 추출 방식 |
|---|---|---|---|
| `openai-responses-server.ts:266-474` | ~210 | `responses/parser.ts` | 리팩토링 (타입 경량화, logger 교체) |
| `openai-responses-server.ts:720-1190` | ~470 | `responses/encoder.ts` | 리팩토링 (id 생성기 단순화) |
| `openai-responses-server-schema.ts` | 290 | `responses/schema.ts` | 거의 그대로 (Zod 의존 유지) |
| `openai-chat-server.ts` | 635 | 참고만 | Chat→Context 방향은 불필요, Context→Chat만 필요 |
| `auth-gateway/types.ts` | 135 | `types.ts` | 경량화 (필요한 옵션만) |
