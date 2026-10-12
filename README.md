# OTestManager2026 — MCP 서버

외부 LLM 클라이언트(Claude Desktop, Claude Code 등)가 OTestManager2026 프로젝트에
테스트 케이스를 만들고, 실행 결과를 조회·기록하고, 결함을 등록할 수 있게 해주는 MCP 서버입니다.

이 서버는 상태를 갖지 않는 얇은 어댑터입니다 — 모든 툴 호출은 그대로 OTestManager2026
공개 API(`/api/v1/projects/<프로젝트>/*`)를 계정 API 키로 호출할 뿐입니다.

## 설치

```bash
cd mcp-server
npm install
```

설치형(on-premise) OTestManager를 쓴다면 설치할 것이 없습니다. 로그인한 뒤 **내 API 키** 화면에서 **MCP 서버 파일 받기**로 `otestmanager-mcp.mjs` 한 파일을 받으면 됩니다. 필요한 라이브러리가 모두 들어 있어 Node.js 18 이상만 있으면 `node otestmanager-mcp.mjs`로 바로 실행되고, 인터넷(npm)이 없는 PC에서도 동작합니다. 같은 파일은 저장소에서 `cd server && node scripts/build-mcp.mjs`로 만들 수 있습니다(`mcp-server/dist/otestmanager-mcp.mjs`).

## 사용법

1. OTestManager2026 사이드바 아래의 **내 API 키**에서 키를 발급받습니다. 조직 관리자는 항상 발급할 수 있고,
   그 외 멤버는 조직 관리자가 **내 조직** 화면에서 **모든 멤버 발급 가능**으로 설정한 조직에서만 발급할 수 있습니다.
2. MCP 클라이언트(Claude Desktop 등) 설정에 다음과 같이 등록합니다:

```json
{
  "mcpServers": {
    "otestmanager": {
      "command": "node",
      "args": ["/path/to/OTestManager/mcp-server/index.js"],
      "env": {
        "OTM_SERVER_URL": "http://localhost:4000",
        "OTM_API_KEY": "otm_u_xxx"
      }
    }
  }
}
```

키는 발급 시 1번만 표시되므로 미리 복사해 두세요.

### 프로젝트 지정

계정 API 키 하나로 **내가 접근할 수 있는 모든 프로젝트**를 다룹니다. 그래서 `get_automation_script_guide`와
`list_my_projects`를 뺀 모든 툴은 **`project` 인자가 필수**입니다. 다음 중 하나로 지정합니다.

- 프로젝트 이름 (예: `쇼핑몰 웹`)
- 프로젝트 코드 (예: `ABC123`, 대소문자 무관)
- 프로젝트 ID, 또는 브라우저 주소창의 프로젝트 URL
- 여러 조직에 같은 이름이나 코드가 있으면 `조직명/코드` (예: `STA/ABC123`)

해당하는 프로젝트가 여러 개면 후보 목록과 함께 오류를 돌려주고, 추측해서 고르지 않습니다. 접근할 수 있는
프로젝트는 `list_my_projects`로 확인합니다. 이 목록은 이름·코드·ID만 보여주고 내용은 포함하지 않습니다.

키는 **내가 그 프로젝트에 접근할 수 있는 동안에만** 동작합니다. 판단은 호출할 때마다 새로 합니다.
- 조직 관리자는 그 조직의 모든 프로젝트, 테스터는 자기가 배정된 프로젝트만 접근할 수 있습니다.
- 관리자가 아니라면 그 조직이 **모든 멤버 발급 가능**이어야 합니다. **관리자만 발급 가능**으로 바뀌면 그 조직에서는 바로 막힙니다.
- 발급할 때 사용할 조직을 좁혔다면 그 조직들에서만 동작합니다.

### 읽기 전용 키

발급할 때 **읽기 전용**을 고르면 MCP 서버가 조회 툴만 등록합니다(케이스·요구사항·세션·결과·결함·데이터셋·검토 확정·변경 영향 분석을
바꾸는 쓰기 툴 25개는 나타나지 않습니다). 서버도 GET 외의 요청을 거절합니다.
예외는 `decide` 하나로, 판정은 데이터를 바꾸지 않으므로 읽기 전용 키로도 호출됩니다.

### 이전 방식의 프로젝트 키

프로젝트 관리 화면에서 발급하던 프로젝트 단위 키(`otm_…`)는 더 이상 새로 발급하지 않지만, 이미 발급된 키는
그대로 동작합니다. 이 키로 연결하면 서버가 키 종류를 자동으로 알아보고 예전처럼 `project` 인자 없이 그 한
프로젝트만 다룹니다.

### 데이터 주도 실행과 변경 영향 분석

QA Copilot이 이 서버로 하는 두 가지 흐름입니다. 둘 다 판정은 **이 키 계정의 결정 모델**(계정 메뉴의 내 결정 모델,
없으면 설치 기본값)이 맡으므로 `get_decision_config`로 먼저 확인하세요.

- **데이터 주도 케이스** — `create_test_case`로 케이스를 만들고(또는 기존 케이스에) `set_case_dataset`으로 데이터셋을
  붙입니다: 열마다 `kind`(text·money·number·url·image·enum)와 `compare`(exact·semantic·ignore), 행은 `{ 열키: 기대값 }`,
  `keyColumn`은 행을 알아보는 열. image 열의 셀은 `{ file, image }`로 기획서의 기대 사진을 함께 보낼 수 있습니다.
  스크립트는 `get_automation_script_guide({ kind: "DATASET" })`의 규칙대로 — 행을 `OTM_DATA_ROW`로 받고 판정 없이
  마지막 줄에 `OTM_OBSERVED: {...}`만 출력 — 써서 `attach_automation_script`로 붙이고, `run_case_automation`으로
  실행하면 컴패니언이 행마다 프로세스를 띄웁니다. 결과는 `get_automation_run_status`(전체)와 `list_run_iterations`(행별
  판정)로 읽고, 결정 모델이 확신하지 못한 REVIEW 행은 사람의 몫입니다 — 사용자가 허용한 경우에만 `review_iteration`으로
  확정하세요.
- **변경 영향 분석** — 변경 요약(마크다운, `## 영역` 제목으로 항목을 나눔)을 `run_impact_analysis`에 주면 바로 id가
  돌아오고 분류는 백그라운드로 진행됩니다. `get_impact_analysis`를 폴링해 `status`가 DONE이 되면 항목(impact·확신도·
  영향 준 항목·resolution)을 읽고, 수정이 필요한 것(TEXT/SCRIPT/BOTH)은 `update_test_case`·`attach_automation_script`로
  고치거나 `create_test_case`로 새 케이스를 만든 뒤 `resolve_impact_item(APPLIED, note)`로 기록합니다. 폐기(OBSOLETE)는
  `remove_automation_script` + `update_test_case({ category: "폐기 후보" })`로 옮기고 `DISMISSED`로 처리하는 것이 QA Copilot의
  방식입니다. 확신도가 임계값 아래인 항목과 50%에 못 미치는 "영향 없음"은 `NEEDS_HUMAN`으로 시작하니 사람에게 보여 주세요.
  케이스별 과거 판정은 `get_case_impact_history`.

## 공개 API로 직접 호출

MCP 없이 같은 키로 REST API를 호출할 수 있습니다. MCP 툴은 모두 이 API를 그대로 호출합니다.

```bash
# 접근 가능한 프로젝트 목록 (이름·코드·ID만)
curl -H "X-Api-Key: otm_u_xxx" https://<서버>/api/v1/projects

# 이름·URL·"조직/코드"를 프로젝트 ID로 바꾸기 (쿼리 문자열로 넘기므로 슬래시가 있어도 안전)
curl -H "X-Api-Key: otm_u_xxx" "https://<서버>/api/v1/projects/resolve?ref=<이름 또는 URL>"

# 프로젝트 데이터 — 경로에는 프로젝트 ID나 코드를 넣습니다
curl -H "X-Api-Key: otm_u_xxx" https://<서버>/api/v1/projects/<ID 또는 코드>/requirements
```

`/api/v1/me`는 키 이름·종류·권한·만료일과 소유자를 돌려줍니다. 프로젝트 아래 경로는 기존 MCP API와 같습니다
(`/requirements`, `/test-cases`, `/sessions`, `/bugs`, `/companions`, `/summary` …).

## 제공 툴

| 툴 | 설명 |
|---|---|
| `list_my_projects` | 이 키로 접근할 수 있는 프로젝트 목록(조직, 이름, 코드, ID, 상태). 내용은 포함하지 않음. 계정 키에서만 제공 |
| `get_project` | 프로젝트 이름/코드/상세 내용/상태 조회 |
| `update_project_description` | 프로젝트 상세 내용(설명) 작성/수정 |
| `list_documents` | 프로젝트 첨부 문서 목록 |
| `attach_document` | 프로젝트에 문서 첨부 (base64, 최대 10MB) |
| `remove_document` | 프로젝트 첨부 문서 삭제 |
| `list_requirements` | 프로젝트의 요구사항 목록 / `q`로 ID·내용 검색. 각 요구사항은 `folderId`를 포함 |
| `get_requirement` | 요구사항 하나의 전체 상세 조회 (버전, 이 요구사항을 검증하는 테스트 케이스 목록 포함) |
| `create_requirement` | 새 요구사항 등록 — `category` 지정 시 요구사항 폴더 트리의 해당 하위 폴더에 정리됨(없으면 자동 생성) |
| `update_requirement` | 기존 요구사항 내용 수정 (ID는 유지, 내용이 바뀌면 이전 버전 이력 자동 보존) |
| `list_folders` | 프로젝트의 폴더 트리(id/name/parentId 평평한 목록) — `kind`로 테스트 케이스(기본값) 또는 요구사항 트리 선택. `list_test_cases`/`list_requirements`의 `folderId`와 대조해 계층 구조 조립 |
| `list_test_cases` | 프로젝트의 테스트 케이스 목록 / `q`(키워드), `priority`, `automationScriptKind`, `hasAutomation`으로 검색·필터링. 각 케이스는 `folderId`를 포함 |
| `create_test_case` | 새 테스트 케이스를 이 프로젝트에 생성. `category`를 지정하면 이 프로젝트의 폴더 트리에서 그 이름의 하위 폴더에 담김(같은 이름 재사용 시 같은 폴더로 모임, 없으면 자동 생성) — 생략하면 최상위에 바로 담김. `requirementIds`를 지정하면 생성과 동시에 해당 요구사항(들)과 매칭됨(프로젝트 레벨). ID는 `<프로젝트코드>-TC-00001` 형식(5자리)으로 자동 채번 |
| `get_test_case` | 테스트 케이스 하나의 전체 상세 조회 (첨부된 자동화 스크립트 원문, 속한 폴더 `folderId` 포함) |
| `update_test_case` | 테스트 케이스의 제목/목적/사전조건/입력값/기대결과/우선순위/스텝 수정 (전달한 필드만 변경, 수정 전 내용은 버전 이력으로 보존). `folderId`(list_folders의 ID, `null`이면 최상위) 또는 `category`(최상위 폴더 이름, 없으면 생성; 둘 다 주면 `folderId` 우선)로 다른 폴더로 옮길 수도 있음 — 옮기기만 하면 버전은 그대로 |
| `get_automation_script_guide` | 스크립트 작성 전 참고할 가이드 — kind별(NODE_TS/JMETER/POSTMAN/PYTHON) 작성 규칙 + 실제 동작하는 예시 스크립트 |
| `attach_automation_script` | 테스트 케이스에 자동화 스크립트 첨부/교체(=수정) — 파일 확장자로 종류 자동 판별 (.ts: Node.js/Playwright/Appium/OWASP ZAP, .jmx: JMeter, .json: Postman/Newman, .py: Python/Selenium — 모두 OTM Companion이 실행하며, 그 도구를 설치한 컴패니언에만 보냄). 실제 저장 파일명은 전달한 fileName을 그대로 쓰지 않고 케이스 ID·제목 기반으로 서버가 재생성함(fileName은 확장자 판별 용도). content 맨 앞에 실제 엔진(Playwright/Appium/OWASP ZAP/Node.js/JMeter/Postman/Selenium)을 표시하는 주석(.ts/.jmx/.py) 또는 info.description(.json)을 반드시 포함해야 함. 이전 스크립트는 버전 이력으로 보관. `steps`를 함께 넘기면 케이스의 텍스트 스텝도 갱신(이때 케이스 버전 이력도 남음) |
| `remove_automation_script` | 테스트 케이스의 자동화 스크립트 제거 (마찬가지로 버전 이력에 보관) |
| `list_automation_script_versions` | 자동화 스크립트 이전 버전 이력 조회 |
| `list_sessions` | 세션(실행 사이클) 목록 |
| `create_session` | 새 세션 생성 (프로젝트의 모든 테스트 케이스 자동 포함, 기본 "실행" 회차 생성) |
| `list_session_cases` | 세션에 포함된 케이스 목록 |
| `add_case_to_session` | 이미 존재하는 세션에 케이스 추가 (create_session은 호출 시점에 존재하던 케이스만 포함하므로, 나중에 만든 케이스는 이걸로 추가). 케이스 ID 또는 코드, 이미 들어 있으면 그대로 돌려줌(`alreadyInSession`) |
| `get_case_requirements` | 세션 케이스가 현재 검증하는 요구사항 목록 조회 |
| `update_case_requirements` | 테스트 케이스가 검증하는 요구사항 지정 (프로젝트 레벨 요구사항 커버리지, 호출마다 전체 교체). 요구사항은 ID나 코드로, 같은 것이 겹쳐도 한 번으로 셈 |
| `list_rounds` | 세션의 실행 회차 목록 |
| `get_round_results` | 실행 회차의 케이스별 결과 전체 목록 |
| `get_round_test_case_result` | 실행 회차의 결과 하나만 조회 (resultId를 이미 알고 있을 때, 전체 목록 재조회 없이) |
| `record_result` | 실행 결과 직접 기록 (Pass/Fail/Blocked/N/A) — 자동화 스크립트가 없는 케이스나 수동 판단 결과용. `comment`를 생략하면 기존 코멘트 유지, null이면 지움 |
| `run_case_automation` | 케이스에 첨부된 자동화 스크립트를 실제 OTM Companion에서 실행하고 결과를 반영 (`companionId`로 지정 가능). 최대 약 45초 기다리고, 그 안에 끝나지 않으면 `IN_PROGRESS`와 `runId`를 돌려줌(실행은 계속되며 `get_automation_run_status`로 확인 — MCP 클라이언트의 60초 호출 제한과 프록시 제한 시간에 걸리지 않도록). 그 결과가 아직 실행 중(대기열 포함)이면 새로 실행하지 않고 거부하며 진행 중인 `runId`를 알려줌. 컴패니언이 5분 안에 시작을 알리지 않거나, 스크립트 제한 시간에 10분을 더해도 결과가 없거나, 연결되지 않은 컴패니언을 24시간 기다리면 서버가 오류로 정리 |
| `get_automation_run_status` | `run_case_automation`이 시간 내 끝나지 않았을 때 최종 결과(로그, 아티팩트 목록 포함) 재확인 |
| `cancel_automation_run` | 아직 끝나지 않은 자동 실행(대기 중이거나 실행 중)을 중단 — 실행 탭의 중단 버튼과 같음 |
| `get_automation_run_artifact` | 실행 결과의 첨부 파일 내용 가져오기 — 이미지는 이미지로, 그 밖의 파일은 base64로 (최대 10MB) |
| `list_companions` | 이 프로젝트를 실행할 수 있는 OTM Companion의 연결 여부·실행 가능한 스크립트 종류(capabilities)·이 프로젝트용 테스트 값 키(`testValueKeys`, 값 없음) 조회 — `run_case_automation` 호출 전 미리 확인용. 예전 이름 `list_runners`도 같은 동작 |
| `get_case_dataset` | 데이터 주도 케이스의 데이터셋(열 정의, 행, 키 열, maxParallel) 조회. `images`는 기대 사진이 붙은 셀의 목록 `{ [행 _id]: { [열 키]: { mimeType, size } } }` |
| `set_case_dataset` | 케이스에 데이터셋을 붙여 데이터 주도 케이스로 설정 (최대 2000행·40열, 기존 데이터셋은 버전으로 보관). `image` 열의 셀은 `{ file, image }` 객체로 기획서의 기대 사진(JPEG/PNG/WebP data URL 또는 base64, 1장 300KB·전체 12MB)을 붙일 수 있어 결정 모델이 요소 스크린샷과 사진을 직접 비교. 문자열 셀은 이미 있는 사진을 유지 |
| `get_case_dataset_image` | 데이터셋 셀 하나의 기대 사진을 base64로 가져오기 |
| `remove_case_dataset` | 케이스의 데이터셋 제거 (스크립트는 그대로) |
| `list_run_iterations` | 데이터 주도 실행(`runId`)의 행별 결과 — 집계(passed/failed/error/review/pending)와 행마다 rowKey·status(PASSED/FAILED/ERROR/REVIEW…)·observed·열별 verdicts(expected/observed/match/probability/decidedBy)·log·artifacts, `status`로 필터 |
| `review_iteration` | 결정 모델이 확신하지 못해 REVIEW로 남은 행(또는 열 하나)을 일치/불일치로 확정 — 모든 행이 확정되면 실행과 회차 결과가 PASSED/FAILED로 정해짐. 계정 API 키만, 확정한 사람으로 기록 |
| `run_impact_analysis` | 변경 요약(마크다운, `## 영역`/`- 항목`으로 나눔)으로 프로젝트의 케이스 전체 또는 `folderIds`/`caseIds` 범위를 결정 모델로 분류 시작 — 케이스마다 UNAFFECTED/TEXT/SCRIPT/BOTH/OBSOLETE/UNKNOWN, 확률, 영향 준 항목. 백그라운드 진행이라 바로 id·total을 돌려주고, 임계값 아래 항목과 50% 미만 UNAFFECTED는 NEEDS_HUMAN으로 시작. 진행 중인 분석이 있으면 409(ALREADY_RUNNING) |
| `get_impact_analysis` | 분석의 진행(RUNNING/DONE/FAILED, done/total), 종류별·처리별 요약, 항목 목록(케이스 코드·제목·스크립트 유무, impact, probability, area, distribution, resolution, note) — `impact`/`resolution`으로 필터 |
| `list_impact_analyses` | 이 프로젝트의 변경 영향 분석 목록(최근순, 상태·진행·요청자) |
| `resolve_impact_item` | 영향 항목의 처리 상태 변경 — APPLIED(고쳤음, note에 내용) / DISMISSED(해당 없음) / OPEN·NEEDS_HUMAN(되돌림). 실제 수정은 `update_test_case`·`attach_automation_script`로 한 뒤 기록 |
| `get_case_impact_history` | 케이스 하나가 과거 분석에서 받은 판정과 처리 내역(최근 10건) — 결과 분석 때 "최근 변경으로 스크립트가 고쳐졌는지" 확인용 |
| `get_decision_config` | 이 키 계정의 결정 모델(System One, 없으면 설치 기본값)이 설정되어 있는지, 텍스트/이미지 판정 모델, 이미지 입력 가능 여부(`imageVision` — 연결 테스트가 판별), 자동 반영 확신도(`autoThreshold`) 조회 |
| `decide` | 이 키 계정의 결정 모델에 상태(`state`)와 타입이 정해진 질문들(`choice`·`noul`·`score`, 한 번에 최대 64개)을 보내 질문마다 타입 있는 답과 확률을 받음 — 텍스트 생성 없이 분류·판정·채점만. 수백 건을 빠르고 싸게 판정할 때 LLM 대신 사용. 읽기 전용 키로도 호출 가능. 결정 모델이 없으면 404 |
| `create_bug` | 결함 등록 (선택적으로 `roundId`를 넘기면 실행 사이클도 함께 기록) |
| `list_bugs` | 결함 목록 조회 / `status`·`severity`·`priority`·`q`(키워드)로 검색·필터링 |
| `get_bug` | 결함 하나의 전체 상세 조회 |
| `update_bug` | 결함 수정 및 상태 전이(OPEN→IN_PROGRESS→FIXED→CLOSED), 연관된 실행 사이클(`roundId`)·세션 케이스(`cycleCaseId`) 재지정/해제(null) — 둘은 같은 세션의 것이어야 함(하나만 바꿔도 남은 쪽과 맞는지 확인). 수정 전 내용은 이전 버전 이력으로 자동 보존 |
| `link_bug_to_result` | 이미 등록된 결함이 다른 세션/회차에서 다시 발견됐을 때, 원래 발견 위치는 그대로 두고 이번 실행도 함께 기록 (같은 조합은 한 번만) |
| `attach_bug_evidence` | 결함에 증거 파일을 base64로 직접 올려 첨부 (최대 10MB) — 실행 아티팩트가 아닌 작은 파일용 |
| `attach_run_artifact_to_bug` | 자동화 실행의 아티팩트(스크린샷·영상 등)를 서버에서 바로 결함에 복사해 첨부 — 파일 내용을 주고받지 않음 |
| `get_project_summary` | 테스트 케이스 수/요구사항 커버리지/세션 수/상태별 결함 수를 한 번에 조회 |

API 키로 직접 기록한 실행 결과·결함에는 "🔑 (키 이름)" 배지가 붙어, 사람이 실행한 것과 구분됩니다.
자동화 스크립트가 첨부된 케이스는 `record_result`로 직접 판정하지 말고 `run_case_automation`을 사용하세요 —
실제 OTM Companion이 스크립트를 구동한 결과가 반영되어 "실행자"란에 컴패니언 이름(🤖)이 표시됩니다.

로그인이 필요한 사이트의 스크립트에는 계정·주소를 값으로 적지 말고 `process.env.OTM_VAR_<키>`(JMeter
`${__P(키)}`, Postman `{{키}}`, Python `os.environ["OTM_VAR_<키>"]`)로 참조하세요. 값은 서버에 없고, 실행하는 사람 PC의 OTM Companion이
자기 "테스트 계정"에서 주입합니다. 각 컴패니언이 가진 키 이름은 `list_companions`의 `testValueKeys`로
확인합니다 — 규칙 전체는 `get_automation_script_guide`와 OTestManager 메인 README 참고(이 폴더는 공개
저장소로 미러링되므로 상대 경로 링크는 걸지 않습니다).

Appium/JMeter/Postman/OWASP ZAP/Python(Selenium)처럼 이 저장소 밖의 도구를 대상으로 스크립트를 작성해야 한다면, 먼저
`get_automation_script_guide`를 호출하세요 — 실제로 실행되는 방식(판정 기준, 필수 요소, 환경
제약)과 그대로 첨부해서 쓸 수 있는 예시가 kind별로 들어 있습니다.
