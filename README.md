# OTestManager2026 — MCP 서버

외부 LLM 클라이언트(Claude Desktop, Claude Code 등)가 OTestManager2026의 한 프로젝트에
테스트 케이스를 만들고, 실행 결과를 조회·기록하고, 결함을 등록할 수 있게 해주는 MCP 서버입니다.

이 서버는 상태를 갖지 않는 얇은 어댑터입니다 — 모든 툴 호출은 그대로 OTestManager2026
REST API(`/api/mcp/*`)를 프로젝트 API 키로 호출할 뿐입니다.

## 설치

```bash
cd mcp-server
npm install
```

## 사용법

1. OTestManager2026의 프로젝트 관리 화면에서 API 키를 발급받습니다.
2. MCP 클라이언트(Claude Desktop 등) 설정에 다음과 같이 등록합니다:

```json
{
  "mcpServers": {
    "otestmanager": {
      "command": "node",
      "args": ["/path/to/OTestManager/mcp-server/index.js"],
      "env": {
        "OTM_SERVER_URL": "http://localhost:4000",
        "OTM_API_KEY": "otm_xxx"
      }
    }
  }
}
```

키는 발급 시 1번만 표시되므로 미리 복사해 두세요. 이 키는 **해당 프로젝트에만** 접근할 수 있습니다.

## 제공 툴

| 툴 | 설명 |
|---|---|
| `get_project` | 프로젝트 이름/코드/상세 내용/상태 조회 |
| `update_project_description` | 프로젝트 상세 내용(설명) 작성/수정 |
| `list_documents` | 프로젝트 첨부 문서 목록 |
| `attach_document` | 프로젝트에 문서 첨부 (base64, 최대 10MB) |
| `remove_document` | 프로젝트 첨부 문서 삭제 |
| `list_requirements` | 프로젝트의 요구사항 목록 / `q`로 ID·내용 검색 |
| `create_requirement` | 새 요구사항 등록 |
| `update_requirement` | 기존 요구사항 내용 수정 (ID는 유지, 내용이 바뀌면 이전 버전 이력 자동 보존) |
| `list_test_cases` | 프로젝트의 테스트 케이스 목록 / `q`(키워드), `priority`, `automationScriptKind`, `hasAutomation`으로 검색·필터링 |
| `create_test_case` | 새 테스트 케이스를 이 프로젝트에 생성. `category`를 지정하면 이 프로젝트의 폴더 트리에서 그 이름의 하위 폴더에 담김(같은 이름 재사용 시 같은 폴더로 모임, 없으면 자동 생성) — 생략하면 최상위에 바로 담김. ID는 `<프로젝트코드>-TC-00001` 형식(5자리)으로 자동 채번 |
| `get_test_case` | 테스트 케이스 하나의 전체 상세 조회 (첨부된 자동화 스크립트 원문 포함) |
| `update_test_case` | 테스트 케이스의 제목/목적/사전조건/입력값/기대결과/우선순위/스텝 수정 (전달한 필드만 변경) |
| `get_automation_script_guide` | 스크립트 작성 전 참고할 가이드 — kind별(NODE_TS/JMETER/POSTMAN) 작성 규칙 + 실제 동작하는 예시 스크립트 |
| `attach_automation_script` | 테스트 케이스에 자동화 스크립트 첨부/교체(=수정) — 파일 확장자로 종류 자동 판별 (.ts: Node.js/Playwright/Appium/OWASP ZAP, .jmx: JMeter, .json: Postman/Newman, 전부 러너에서 실행 가능). 이전 스크립트는 버전 이력으로 보관 |
| `remove_automation_script` | 테스트 케이스의 자동화 스크립트 제거 (마찬가지로 버전 이력에 보관) |
| `list_automation_script_versions` | 자동화 스크립트 이전 버전 이력 조회 |
| `list_sessions` | 세션(실행 사이클) 목록 |
| `create_session` | 새 세션 생성 (프로젝트의 모든 테스트 케이스 자동 포함, 기본 "실행" 회차 생성) |
| `list_session_cases` | 세션에 포함된 케이스 목록 |
| `add_case_to_session` | 이미 존재하는 세션에 케이스 추가 (create_session은 호출 시점에 존재하던 케이스만 포함하므로, 나중에 만든 케이스는 이걸로 추가) |
| `get_case_requirements` | 세션 케이스가 현재 검증하는 요구사항 목록 조회 |
| `update_case_requirements` | 세션 케이스가 검증하는 요구사항 지정 (요구사항 커버리지, 호출마다 전체 교체) |
| `list_rounds` | 세션의 실행 회차 목록 |
| `get_round_results` | 실행 회차의 케이스별 결과 전체 목록 |
| `get_round_test_case_result` | 실행 회차의 결과 하나만 조회 (resultId를 이미 알고 있을 때, 전체 목록 재조회 없이) |
| `record_result` | 실행 결과 직접 기록 (Pass/Fail/Blocked/N/A) — 자동화 스크립트가 없는 케이스나 수동 판단 결과용 |
| `run_case_automation` | 케이스에 첨부된 자동화 스크립트를 실제 연결된 러너에서 실행하고 결과를 반영 |
| `get_automation_run_status` | `run_case_automation`이 시간 내 끝나지 않았을 때 최종 결과(로그, 아티팩트 목록 포함) 재확인 |
| `get_automation_run_artifact` | 실행 결과의 첨부 파일(스크린샷/영상/.jtl 등)을 base64로 가져오기 (최대 10MB) |
| `list_runners` | 프로젝트에 배정된 러너의 온라인 여부·실행 가능한 스크립트 종류(capabilities) 조회 — `run_case_automation` 호출 전 미리 확인용 |
| `create_bug` | 결함 등록 (선택적으로 `roundId`를 넘기면 실행 사이클도 함께 기록) |
| `list_bugs` | 결함 목록 조회 / `status`·`severity`·`priority`·`q`(키워드)로 검색·필터링 |
| `get_bug` | 결함 하나의 전체 상세 조회 |
| `update_bug` | 결함 수정 및 상태 전이(OPEN→IN_PROGRESS→FIXED→CLOSED), 연관된 실행 사이클(`roundId`)·세션 케이스(`cycleCaseId`) 재지정/해제(null). 수정 전 내용은 이전 버전 이력으로 자동 보존 |
| `get_project_summary` | 테스트 케이스 수/요구사항 커버리지/세션 수/상태별 결함 수를 한 번에 조회 |

API 키로 직접 기록한 실행 결과·결함에는 "🔑 (키 이름)" 배지가 붙어, 사람이 실행한 것과 구분됩니다.
자동화 스크립트가 첨부된 케이스는 `record_result`로 직접 판정하지 말고 `run_case_automation`을 사용하세요 —
실제 러너가 스크립트를 구동한 결과가 반영되어 "실행자"란에 러너 이름(🤖)이 표시됩니다.

Appium/JMeter/Postman/OWASP ZAP처럼 이 저장소 밖의 도구를 대상으로 스크립트를 작성해야 한다면, 먼저
`get_automation_script_guide`를 호출하세요 — 러너가 실제로 실행하는 방식(판정 기준, 필수 요소, 환경
제약)과 그대로 첨부해서 쓸 수 있는 예시가 kind별로 들어 있습니다.
