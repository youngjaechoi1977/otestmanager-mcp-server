#!/usr/bin/env node
// OTestManager2026 MCP server — a thin adapter exposing one project's test cases,
// sessions, execution results, and bugs to external LLM clients (e.g. Claude Desktop,
// Claude Code) via a project-scoped API key. It holds no state of its own; every tool
// call just forwards to the OTestManager2026 REST API under /api/mcp/*.
//
// Usage (e.g. in a Claude Desktop mcpServers config):
//   {
//     "command": "node",
//     "args": ["/path/to/mcp-server/index.js"],
//     "env": {
//       "OTM_SERVER_URL": "http://localhost:4000",
//       "OTM_API_KEY": "otm_xxx"
//     }
//   }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SERVER_URL = process.env.OTM_SERVER_URL || 'http://localhost:4000';
const API_KEY = process.env.OTM_API_KEY;
if (!API_KEY) {
  console.error('OTM_API_KEY 환경변수가 필요합니다 (프로젝트 관리 화면에서 발급).');
  process.exit(1);
}

async function callApi(path, options = {}) {
  const res = await fetch(`${SERVER_URL}/api/mcp${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
      ...options.headers,
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error || `요청 실패 (${res.status})`);
  }
  return body;
}

// Builds a query string from only the params the caller actually passed (undefined values
// are dropped) — used by the search/filter tools that layer optional filters onto a list_* GET.
function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'otestmanager', version: '1.0.0' });

// Returned by get_automation_script_guide — the runner actually executing these scripts
// lives in a separate repo the external LLM client can't read, so these conventions and
// examples are duplicated here (kept in sync with runner/README.md) rather than assumed
// knowledge.
const SCRIPT_GUIDES = {
  OVERVIEW:
    '자동화 스크립트는 파일명 확장자로 종류가 자동 판별됩니다 (attach_automation_script 호출 시 별도 kind 지정 불필요):\n' +
    '- .ts → NODE_TS: 순수 Node.js, Playwright(브라우저), Appium(모바일, webdriverio), OWASP ZAP(보안 스캔) 스크립트 모두 이 확장자.\n' +
    '- .jmx → JMETER: JMeter 부하테스트 (JMeter GUI/CLI로 만든 테스트 플랜 XML).\n' +
    '- .json → POSTMAN: Postman 컬렉션 export (v2.1 권장).\n\n' +
    '**모든 스크립트는 맨 위에 실제 사용하는 자동화 엔진(Playwright / Appium / OWASP ZAP / 순수 Node.js / ' +
    'JMeter / Postman)을 명시하는 표시를 남겨야 합니다** — 특히 .ts는 확장자만으로는 Playwright인지 ' +
    'Appium인지 ZAP인지 순수 Node.js인지 구분이 안 되므로 필수입니다. 형식은 종류별 가이드 참고 ' +
    '(get_automation_script_guide({ kind })).\n\n' +
    '세 종류 모두 run_case_automation으로 실제 러너에서 실행하고, get_automation_run_status로 ' +
    '결과(Pass/Fail, 로그, 아티팩트)를 가져올 수 있습니다. 종류별 상세 작성 규칙과 예시는 ' +
    'get_automation_script_guide({ kind })로 조회하세요 — kind는 "NODE_TS", "JMETER", "POSTMAN" 중 하나입니다.',

  NODE_TS:
    '## NODE_TS (.ts) — Node.js / Playwright / Appium\n\n' +
    '러너가 tsx로 직접 실행합니다. 종료 코드 0 = PASS, 그 외 = FAIL. console.log/console.error 출력이 ' +
    '그대로 실행 로그에 남고, 스크립트가 실행 디렉터리에 남긴 파일(스크린샷 등)은 파일명과 무관하게 ' +
    '전부 자동으로 아티팩트 첨부됩니다.\n\n' +
    '**.ts는 확장자만으로 엔진을 구분할 수 없으므로, 스크립트 맨 첫 줄에 반드시 `// Engine: ' +
    '<Playwright|Appium|OWASP ZAP|Node.js>` 형식의 주석을 남기세요.** 아래 각 예시 참고.\n\n' +
    '### 순수 Node.js (HTTP 레벨 검증)\n' +
    '```ts\n' +
    "// Engine: Node.js\n" +
    "const res = await fetch('https://example.com');\n" +
    "if (!res.ok) throw new Error(`응답 오류: ${res.status}`);\n" +
    "console.log('PASS: 사이트가 정상 응답합니다.');\n" +
    '```\n\n' +
    '### Playwright (실제 브라우저)\n' +
    "기본은 headless입니다. 사람이 실행 탭에서 '브라우저 표시'를 켠 실행에 한해 환경변수 " +
    'OTM_HEADLESS=false가 전달되니, 스크립트가 이 값을 읽어 반영해야 합니다.\n' +
    '```ts\n' +
    "// Engine: Playwright\n" +
    "import { chromium } from 'playwright';\n\n" +
    "const headless = process.env.OTM_HEADLESS !== 'false';\n" +
    'const browser = await chromium.launch({ headless });\n' +
    "const context = await browser.newContext({ recordVideo: { dir: '.' } }); // 실패 시에도 영상 보존\n" +
    'const page = await context.newPage();\n\n' +
    'try {\n' +
    "  await page.goto('https://example.com');\n" +
    "  await page.click('text=로그인');\n" +
    "  await page.waitForURL('**/dashboard');\n" +
    "  console.log('PASS: 로그인 후 대시보드로 정상 이동했습니다.');\n" +
    '} catch (err) {\n' +
    "  await page.screenshot({ path: 'failure.png' }); // 자동으로 아티팩트 첨부됨\n" +
    "  console.error('FAIL:', err.message);\n" +
    '  process.exitCode = 1;\n' +
    '} finally {\n' +
    '  await context.close();\n' +
    '  await browser.close();\n' +
    '}\n' +
    '```\n\n' +
    '### Appium (모바일 앱, webdriverio)\n' +
    'Appium 서버는 러너의 `appium` CLI가 설치되어 있으면 러너가 자동으로 함께 띄우지만(포트 4723), ' +
    '연결할 실제 기기/에뮬레이터는 러너가 대신 준비해주지 않습니다 — 미리 연결되어 있어야 하고, ' +
    'capabilities는 그 기기/앱에 맞게 채워야 합니다.\n' +
    '```ts\n' +
    "// Engine: Appium\n" +
    "import { remote } from 'webdriverio';\n\n" +
    'const driver = await remote({\n' +
    "  hostname: 'localhost',\n" +
    '  port: 4723,\n' +
    '  capabilities: {\n' +
    "    platformName: 'Android',\n" +
    "    'appium:automationName': 'UiAutomator2',\n" +
    "    'appium:deviceName': 'emulator-5554',\n" +
    "    'appium:appPackage': 'com.example.app',\n" +
    "    'appium:appActivity': '.MainActivity',\n" +
    '  },\n' +
    '});\n\n' +
    'try {\n' +
    "  const loginButton = await driver.$('~로그인');\n" +
    '  await loginButton.click();\n' +
    "  const dashboard = await driver.$('~대시보드');\n" +
    '  await dashboard.waitForDisplayed({ timeout: 5000 });\n' +
    "  console.log('PASS: 로그인 후 대시보드가 정상적으로 표시됩니다.');\n" +
    '} catch (err) {\n' +
    "  await driver.saveScreenshot('failure.png');\n" +
    "  console.error('FAIL:', err.message);\n" +
    '  process.exitCode = 1;\n' +
    '} finally {\n' +
    '  await driver.deleteSession();\n' +
    '}\n' +
    '```\n\n' +
    '### OWASP ZAP (보안 baseline 스캔)\n' +
    'ZAP 데몬은 러너의 ZAP CLI(`zap.sh`/`zap.bat`)가 설치되어 있으면 러너가 자동으로 함께 띄웁니다(기본 ' +
    '포트 8090) — 별도 클라이언트 라이브러리 없이 순수 fetch로 REST API를 호출합니다. baseline 스캔(spider ' +
    '+ passive scan)만 다루며, 대상 서버에 부하를 주는 active scan은 포함하지 않습니다. **반드시 테스트 ' +
    '권한이 있는 대상만 스캔하세요** — 대상 URL은 케이스의 사전조건/입력값 등에 명시하고, 임의로 다른 ' +
    '서버를 스캔하지 마세요.\n' +
    '```ts\n' +
    "// Engine: OWASP ZAP\n" +
    "const ZAP_BASE = `http://localhost:${process.env.OTM_ZAP_PORT || 8090}`;\n" +
    "const TARGET = 'https://example.com'; // 반드시 허가된 대상만\n\n" +
    'async function zap(path: string) {\n' +
    '  const res = await fetch(`${ZAP_BASE}${path}`);\n' +
    '  if (!res.ok) throw new Error(`ZAP API 오류: ${path} -> ${res.status}`);\n' +
    '  return res.json();\n' +
    '}\n\n' +
    "const { scan: scanId } = await zap(`/JSON/spider/action/scan/?url=${encodeURIComponent(TARGET)}`);\n" +
    'while (true) {\n' +
    '  const { status } = await zap(`/JSON/spider/view/status/?scanId=${scanId}`);\n' +
    '  if (Number(status) >= 100) break;\n' +
    '  await new Promise((r) => setTimeout(r, 2000));\n' +
    '}\n\n' +
    'while (true) {\n' +
    "  const { recordsToScan } = await zap('/JSON/pscan/view/recordsToScan/');\n" +
    '  if (Number(recordsToScan) === 0) break;\n' +
    '  await new Promise((r) => setTimeout(r, 2000));\n' +
    '}\n\n' +
    "const { alerts } = await zap(`/JSON/core/view/alerts/?baseurl=${encodeURIComponent(TARGET)}`);\n" +
    "const risky = alerts.filter((a: any) => a.risk === 'High' || a.risk === 'Medium');\n" +
    'console.log(`ZAP baseline: 알림 ${alerts.length}건 (High/Medium ${risky.length}건)`);\n' +
    'for (const a of alerts) console.log(`- [${a.risk}] ${a.alert}: ${a.url}`);\n\n' +
    'if (risky.length > 0) {\n' +
    "  console.error('FAIL: High/Medium 위험도 알림이 발견되었습니다.');\n" +
    '  process.exitCode = 1;\n' +
    '} else {\n' +
    "  console.log('PASS: High/Medium 위험도 알림이 없습니다.');\n" +
    '}\n' +
    '```',

  JMETER:
    '## JMETER (.jmx) — 부하테스트\n\n' +
    'JMeter가 이미 설치되어 PATH에 있는(또는 OTM_JMETER_BIN으로 지정된) 러너에서 `jmeter -n -t <파일>`로 ' +
    '실행됩니다. **JMeter는 샘플러가 실패해도 프로세스 종료 코드가 0**이므로, Pass/Fail은 결과 파일의 각 ' +
    '샘플 success 값으로 판정합니다 — 반드시 판정 대상 요청에 **응답 어설션(Response Assertion)**이나 ' +
    '**기간 어설션(Duration Assertion)** 등을 넣어야 하나라도 실패 시 FAIL로 기록됩니다 (어설션이 없으면 ' +
    '요청이 뭘 반환하든 항상 PASS로 기록됨).\n\n' +
    '.jmx는 JMeter GUI에서 저장한 XML 파일을 그대로 첨부하면 됩니다 — 순수 텍스트를 손으로 작성하기보다는, ' +
    'JMeter 표준 테스트 플랜 XML 스키마(TestPlan → ThreadGroup → HTTPSamplerProxy → ResponseAssertion 등)를 ' +
    '따라 생성하세요. **XML 선언 바로 다음 줄에 `<!-- Engine: JMeter -->` 주석을 남기세요.** 최소 예시 구조:\n' +
    '```xml\n' +
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- Engine: JMeter -->\n' +
    '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3"><hashTree>\n' +
    '  <TestPlan testname="Test Plan"><boolProp name="TestPlan.functional_mode">false</boolProp></TestPlan>\n' +
    '  <hashTree>\n' +
    '    <ThreadGroup testname="Thread Group">\n' +
    '      <elementProp name="ThreadGroup.main_controller" elementType="LoopController">\n' +
    '        <boolProp name="LoopController.continue_forever">false</boolProp>\n' +
    '        <stringProp name="LoopController.loops">1</stringProp>\n' +
    '      </elementProp>\n' +
    '      <stringProp name="ThreadGroup.num_threads">1</stringProp>\n' +
    '      <stringProp name="ThreadGroup.ramp_time">1</stringProp>\n' +
    '    </ThreadGroup>\n' +
    '    <hashTree>\n' +
    '      <HTTPSamplerProxy testname="GET 요청">\n' +
    '        <stringProp name="HTTPSampler.domain">example.com</stringProp>\n' +
    '        <stringProp name="HTTPSampler.protocol">https</stringProp>\n' +
    '        <stringProp name="HTTPSampler.path">/</stringProp>\n' +
    '        <stringProp name="HTTPSampler.method">GET</stringProp>\n' +
    '      </HTTPSamplerProxy>\n' +
    '      <hashTree>\n' +
    '        <ResponseAssertion testname="응답 코드 = 200">\n' +
    '          <collectionProp name="Asserion.test_strings"><stringProp>200</stringProp></collectionProp>\n' +
    '          <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>\n' +
    '          <intProp name="Assertion.test_type">8</intProp>\n' +
    '        </ResponseAssertion>\n' +
    '        <hashTree/>\n' +
    '      </hashTree>\n' +
    '    </hashTree>\n' +
    '  </hashTree>\n' +
    '</hashTree></jmeterTestPlan>\n' +
    '```\n' +
    '실행 결과에는 `.jtl`(원본 결과)과 JMeter 자체 로그가 아티팩트로 자동 첨부됩니다.',

  POSTMAN:
    '## POSTMAN (.json) — Postman 컬렉션 (Newman으로 실행)\n\n' +
    'Postman에서 Export한 컬렉션 JSON(v2.1 권장)을 그대로 첨부하면, 러너가 `newman run`으로 실행합니다. ' +
    '**Newman은 (JMeter와 달리) 어설션/요청이 실패하면 스스로 종료 코드 1을 반환**하므로 그대로 Pass/Fail로 ' +
    '판정됩니다. **컬렉션의 각 요청에 Tests 스크립트(event.listen="test")로 검증 로직이 있어야 의미 있게 ' +
    'Pass/Fail이 갈립니다** — 요청만 있고 테스트 스크립트가 없으면 응답 내용과 무관하게 항상 PASS로 ' +
    '기록됩니다.\n\n' +
    '**JSON은 주석을 지원하지 않으므로, `info.description`을 `"Engine: Postman"`으로 시작하는 문자열로 ' +
    '채워 엔진을 표시하세요.**\n\n' +
    '```json\n' +
    '{\n' +
    '  "info": { "name": "예시 컬렉션", "description": "Engine: Postman", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },\n' +
    '  "item": [\n' +
    '    {\n' +
    '      "name": "GET 요청",\n' +
    '      "event": [\n' +
    '        {\n' +
    '          "listen": "test",\n' +
    '          "script": { "exec": ["pm.test(\'status is 200\', function () { pm.response.to.have.status(200); });"] }\n' +
    '        }\n' +
    '      ],\n' +
    '      "request": { "method": "GET", "url": "https://example.com/" }\n' +
    '    }\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    '환경 변수가 필요하면 요청 URL/값에 미리 채워서 첨부하세요 — 컬렉션 파일 하나만 전달되는 구조라 ' +
    '별도 Postman 환경 파일은 지원하지 않습니다. 실행 로그에는 Newman CLI 출력(요청별 결과, 실패한 ' +
    '어설션의 기대/실제 값)이 그대로 남고, JSON 리포트(통계·실패 상세·타이밍 — 응답 본문 원본은 용량 ' +
    '문제로 제외)도 아티팩트로 첨부됩니다.',
};

server.registerTool(
  'get_project',
  {
    title: '프로젝트 기본 정보 조회',
    description: '이 API 키에 연결된 프로젝트의 이름, 코드, 상세 내용(설명), 상태를 가져옵니다.',
    inputSchema: {},
  },
  async () => textResult(await callApi('/project'))
);

server.registerTool(
  'update_project_description',
  {
    title: '프로젝트 상세 내용 작성/수정',
    description: '프로젝트의 상세 내용(설명)을 작성하거나 덮어씁니다. 프로젝트 이름/코드/상태는 변경할 수 없습니다.',
    inputSchema: {
      description: z.string().nullable().describe('프로젝트 상세 내용. null이면 비웁니다.'),
    },
  },
  async ({ description }) => textResult(await callApi('/project', { method: 'PATCH', body: JSON.stringify({ description }) }))
);

server.registerTool(
  'list_documents',
  {
    title: '프로젝트 첨부 문서 목록 조회',
    description: '이 프로젝트에 첨부된 문서 목록을 가져옵니다 (파일 내용은 포함하지 않음).',
    inputSchema: {},
  },
  async () => textResult(await callApi('/documents'))
);

server.registerTool(
  'attach_document',
  {
    title: '프로젝트에 문서 첨부',
    description: '프로젝트에 파일을 첨부합니다. 파일 내용은 base64로 인코딩해서 전달해야 합니다 (최대 10MB).',
    inputSchema: {
      filename: z.string().describe('파일명 (확장자 포함)'),
      contentBase64: z.string().describe('파일 내용을 base64로 인코딩한 문자열'),
      mimeType: z.string().optional().describe('MIME 타입 (예: application/pdf, text/plain). 생략 시 application/octet-stream'),
    },
  },
  async (args) => textResult(await callApi('/documents', { method: 'POST', body: JSON.stringify(args) }))
);

server.registerTool(
  'remove_document',
  {
    title: '프로젝트 첨부 문서 삭제',
    description: '프로젝트에서 첨부 문서를 제거합니다.',
    inputSchema: {
      documentId: z.string().describe('list_documents로 조회한 문서 ID'),
    },
  },
  async ({ documentId }) => textResult(await callApi(`/documents/${documentId}`, { method: 'DELETE' }))
);

server.registerTool(
  'list_requirements',
  {
    title: '요구사항 목록 조회 / 검색',
    description:
      '이 API 키에 연결된 프로젝트의 요구사항 목록을 가져옵니다. q를 넘기면 ID/내용에서 검색합니다. ' +
      '각 요구사항은 folderId를 포함하며, list_folders(kind: REQUIREMENT)가 반환하는 폴더 트리 어디에 ' +
      '속하는지 알 수 있습니다(null이면 폴더 없음).',
    inputSchema: {
      q: z.string().optional().describe('요구사항 ID(code) 또는 내용에 포함된 검색어 (대소문자 무시)'),
    },
  },
  async ({ q } = {}) => textResult(await callApi(`/requirements${qs({ q })}`))
);

server.registerTool(
  'create_requirement',
  {
    title: '요구사항 생성',
    description:
      '이 프로젝트에 새 요구사항을 등록합니다. ID는 프로젝트 코드 접두사 + 5자리 번호로 자동 채번됩니다(예: ' +
      '"ABC-REQ-00001"). category를 지정하면 이 프로젝트의 요구사항 폴더 트리에서 그 이름의 하위 폴더에 ' +
      '정리되어 담깁니다(폴더가 없으면 자동 생성) — 관련 요구사항을 여러 개 만들 때는 같은 category 이름을 ' +
      '재사용해 한 폴더에 모으세요. 생략하면 프로젝트의 최상위(폴더 없음)에 바로 담깁니다.',
    inputSchema: {
      text: z.string().describe('요구사항 내용'),
      category: z
        .string()
        .optional()
        .describe('이 프로젝트의 요구사항 폴더 트리에서 이 요구사항을 담을 하위 폴더 이름. 같은 이름을 재사용하면 같은 폴더에 모입니다. 생략하면 최상위에 바로 담깁니다.'),
    },
  },
  async (args) => textResult(await callApi('/requirements', { method: 'POST', body: JSON.stringify(args) }))
);

server.registerTool(
  'update_requirement',
  {
    title: '요구사항 내용 수정',
    description: '기존 요구사항의 내용을 수정합니다. ID(code)는 바뀌지 않으며, 내용이 실제로 바뀌면 수정 전 내용이 이전 버전 이력으로 자동 보존됩니다.',
    inputSchema: {
      requirementId: z.string().describe('list_requirements로 조회한 요구사항 ID'),
      text: z.string().describe('새 요구사항 내용'),
    },
  },
  async ({ requirementId, text }) =>
    textResult(await callApi(`/requirements/${requirementId}`, { method: 'PATCH', body: JSON.stringify({ text }) }))
);

server.registerTool(
  'list_folders',
  {
    title: '폴더 트리 조회 (테스트 케이스 또는 요구사항)',
    description:
      '이 프로젝트의 폴더 트리를 평평한 목록으로 가져옵니다. kind로 테스트 케이스 폴더 트리(기본값) ' +
      '또는 요구사항 폴더 트리를 선택하세요 - 두 트리는 서로 별개입니다. 각 항목은 id/name/parentId를 ' +
      '가지며, parentId가 null이면 최상위 폴더입니다 - 클라이언트가 직접 계층 구조로 조립하세요. ' +
      'list_test_cases/list_requirements가 반환하는 각 항목의 folderId와 대조하면 어느 폴더에 속하는지 ' +
      '알 수 있습니다(folderId가 null이면 폴더 없이 프로젝트 최상위에 바로 담긴 항목).',
    inputSchema: {
      kind: z.enum(['CASE', 'REQUIREMENT']).optional().describe('CASE(기본값)=테스트 케이스 폴더 트리, REQUIREMENT=요구사항 폴더 트리'),
    },
  },
  async ({ kind } = {}) => textResult(await callApi(`/folders?kind=${kind === 'REQUIREMENT' ? 'REQUIREMENT' : 'CASE'}`))
);

server.registerTool(
  'list_test_cases',
  {
    title: '테스트 케이스 목록 조회 / 검색',
    description:
      '이 API 키에 연결된 프로젝트의 테스트 케이스 목록을 가져옵니다. 각 케이스의 ' +
      'automationFileName/automationScript/automationScriptKind로 이미 자동화 스크립트가 첨부되어 ' +
      '있는지, 어떤 종류(NODE_TS/JMETER/POSTMAN)인지 확인할 수 있습니다. folderId로 list_folders가 ' +
      '반환하는 폴더 트리 어디에 속하는지 알 수 있습니다(null이면 폴더 없음). 필터를 하나도 넘기지 않으면 ' +
      '전체 목록을 반환합니다.',
    inputSchema: {
      q: z.string().optional().describe('ID/제목/목적/입력값/기대결과에 포함된 검색어 (대소문자 무시)'),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      automationScriptKind: z.enum(['NODE_TS', 'JMETER', 'POSTMAN']).optional().describe('첨부된 자동화 스크립트 종류로 필터링'),
      hasAutomation: z.boolean().optional().describe('true면 자동화 스크립트가 첨부된 케이스만, false면 없는 케이스만'),
    },
  },
  async ({ q, priority, automationScriptKind, hasAutomation } = {}) =>
    textResult(await callApi(`/test-cases${qs({ q, priority, automationScriptKind, hasAutomation })}`))
);

server.registerTool(
  'create_test_case',
  {
    title: '테스트 케이스 생성',
    description:
      '새 테스트 케이스를 이 프로젝트에 만듭니다. category를 지정하면 이 프로젝트의 테스트 케이스 폴더 ' +
      '트리에서 그 이름의 하위 폴더에 정리되어 담깁니다(폴더가 없으면 자동 생성) — 관련 케이스를 여러 개 ' +
      '만들 때는 같은 category 이름을 재사용해 한 폴더에 모으세요(예: "로그인", "결제", "검색"). 생략하면 ' +
      '프로젝트의 최상위(폴더 없음)에 바로 담깁니다. requirementIds를 지정하면 생성과 동시에 해당 ' +
      '요구사항(들)을 검증하는 케이스로 매칭됩니다(나중에 update_case_requirements로 바꿀 수도 있음). ' +
      '케이스 ID는 프로젝트 코드 접두사 + 5자리 번호로 자동 채번됩니다(예: "ABC-TC-00001").',
    inputSchema: {
      title: z.string().describe('테스트 케이스 제목'),
      purpose: z.string().describe('테스트 목적'),
      input: z.string().describe('입력값'),
      expectedResult: z.string().describe('기대 결과'),
      precondition: z.string().optional().describe('사전조건'),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      steps: z
        .array(z.object({ action: z.string(), expected: z.string() }))
        .optional()
        .describe('테스트 스텝 목록'),
      category: z
        .string()
        .optional()
        .describe('이 프로젝트의 폴더 트리에서 이 케이스를 담을 하위 폴더 이름 (예: "로그인"). 같은 이름을 재사용하면 같은 폴더에 모입니다. 생략하면 최상위에 바로 담깁니다.'),
      requirementIds: z
        .array(z.string())
        .optional()
        .describe('list_requirements로 조회한, 이 케이스가 검증하는 요구사항 ID 목록 (프로젝트 레벨 매칭, 특정 세션에 국한되지 않음). 생략하면 매칭 없이 생성됩니다.'),
    },
  },
  async (args) => textResult(await callApi('/test-cases', { method: 'POST', body: JSON.stringify(args) }))
);

server.registerTool(
  'get_test_case',
  {
    title: '테스트 케이스 상세 조회',
    description: '프로젝트의 테스트 케이스 하나의 전체 상세(스텝, 첨부된 자동화 스크립트 원문 포함)를 가져옵니다.',
    inputSchema: {
      caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID'),
    },
  },
  async ({ caseId }) => textResult(await callApi(`/test-cases/${caseId}`))
);

server.registerTool(
  'update_test_case',
  {
    title: '테스트 케이스 내용 수정',
    description:
      '테스트 케이스의 제목/목적/사전조건/입력값/기대결과/우선순위/스텝을 수정합니다. 전달한 필드만 ' +
      '바뀌고 나머지는 그대로 유지됩니다. 자동화 스크립트는 attach_automation_script로 별도 관리합니다.',
    inputSchema: {
      caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID'),
      title: z.string().optional(),
      purpose: z.string().optional(),
      precondition: z.string().nullable().optional(),
      input: z.string().optional(),
      expectedResult: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      steps: z.array(z.object({ action: z.string(), expected: z.string() })).optional().describe('테스트 스텝 목록 (전달 시 전체 교체)'),
    },
  },
  async ({ caseId, ...patch }) => textResult(await callApi(`/test-cases/${caseId}`, { method: 'PATCH', body: JSON.stringify(patch) }))
);

server.registerTool(
  'attach_automation_script',
  {
    title: '테스트 케이스에 자동화 스크립트 첨부',
    description:
      '이 프로젝트의 테스트 케이스에 자동화 스크립트를 첨부하거나 교체합니다. ' +
      '파일명 확장자로 종류가 자동 판별되며, 셋 다 실행 탭에서 러너로 바로 자동 실행할 수 있습니다: ' +
      '.ts(Node.js/Playwright/Appium), .jmx(JMeter 부하테스트), .json(Postman 컬렉션 export). ' +
      '실제 저장되는 파일명은 fileName으로 전달한 이름을 그대로 쓰지 않고, 케이스 ID와 제목 기반으로 ' +
      '서버가 자동 생성합니다(예: STA-TC-00012_로그인_실패_처리.ts) — fileName은 확장자로 종류를 판별하는 용도입니다. ' +
      'content 맨 앞에는 실제 사용하는 엔진(Playwright/Appium/OWASP ZAP/Node.js/JMeter/Postman)을 표시하는 ' +
      '주석(.ts/.jmx) 또는 info.description(.json)을 반드시 넣으세요 — 형식은 get_automation_script_guide 참고.',
    inputSchema: {
      caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID'),
      fileName: z.string().describe('스크립트 파일명 (.ts, .jmx, .json 중 하나로 끝나야 함 — 확장자만 사용되고 실제 저장 파일명은 케이스 ID·제목 기반으로 서버가 재생성함)'),
      content: z.string().describe('스크립트 전체 내용 — 맨 앞에 실제 엔진(Playwright/Appium/OWASP ZAP/Node.js/JMeter/Postman)을 표시하는 주석 또는 info.description을 포함해야 함'),
    },
  },
  async ({ caseId, fileName, content }) =>
    textResult(await callApi(`/test-cases/${caseId}/script`, { method: 'PUT', body: JSON.stringify({ fileName, content }) }))
);

server.registerTool(
  'remove_automation_script',
  {
    title: '테스트 케이스의 자동화 스크립트 제거',
    description: '테스트 케이스에 첨부된 자동화 스크립트를 제거합니다.',
    inputSchema: {
      caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID'),
    },
  },
  async ({ caseId }) => textResult(await callApi(`/test-cases/${caseId}/script`, { method: 'DELETE' }))
);

server.registerTool(
  'list_sessions',
  {
    title: '세션(실행 사이클) 목록 조회',
    description: '이 프로젝트의 세션 목록을 가져옵니다.',
    inputSchema: {},
  },
  async () => textResult(await callApi('/sessions'))
);

server.registerTool(
  'create_session',
  {
    title: '세션(실행 사이클) 생성',
    description: '이 프로젝트에 새 세션을 만듭니다. 현재 프로젝트의 모든 테스트 케이스가 자동으로 포함되고, 기본 "실행" 회차가 함께 생성됩니다.',
    inputSchema: {
      name: z.string().describe('세션 이름'),
    },
  },
  async (args) => textResult(await callApi('/sessions', { method: 'POST', body: JSON.stringify(args) }))
);

server.registerTool(
  'list_session_cases',
  {
    title: '세션에 포함된 케이스 조회',
    description: '특정 세션에 포함된 테스트 케이스 목록을 가져옵니다.',
    inputSchema: { sessionId: z.string() },
  },
  async ({ sessionId }) => textResult(await callApi(`/sessions/${sessionId}/cases`))
);

server.registerTool(
  'add_case_to_session',
  {
    title: '세션에 케이스 추가',
    description:
      'create_session은 호출 시점에 존재하던 케이스만 세션에 포함시킵니다 — 이미 존재하는 ' +
      '세션에 나중에 만든 케이스를 추가하려면 이 도구를 쓰세요. 이미 포함되어 ' +
      '있으면 아무것도 하지 않고 기존 항목을 그대로 반환합니다(alreadyInSession: true).',
    inputSchema: {
      sessionId: z.string(),
      caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID'),
    },
  },
  async ({ sessionId, caseId }) =>
    textResult(await callApi(`/sessions/${sessionId}/cases`, { method: 'POST', body: JSON.stringify({ caseId }) }))
);

server.registerTool(
  'get_case_requirements',
  {
    title: '세션 케이스가 검증하는 요구사항 조회',
    description: '세션 내 특정 테스트 케이스가 현재 커버하는 요구사항 목록을 가져옵니다.',
    inputSchema: {
      sessionId: z.string(),
      cycleCaseId: z.string().describe('list_session_cases로 조회한 세션 케이스 ID'),
    },
  },
  async ({ sessionId, cycleCaseId }) => textResult(await callApi(`/sessions/${sessionId}/cases/${cycleCaseId}`))
);

server.registerTool(
  'update_case_requirements',
  {
    title: '테스트 케이스의 요구사항 커버리지 설정',
    description:
      '이 프로젝트의 테스트 케이스가 검증하는 요구사항을 지정합니다(프로젝트 레벨 매칭 — 특정 세션에 국한되지 않고 ' +
      '이 케이스가 포함된 모든 세션에 공통 적용). 호출할 때마다 전체 목록을 교체합니다(누적 아님).',
    inputSchema: {
      caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID'),
      requirementIds: z.array(z.string()).describe('list_requirements로 조회한 요구사항 ID 목록'),
    },
  },
  async ({ caseId, requirementIds }) =>
    textResult(
      await callApi(`/test-cases/${caseId}/requirements`, {
        method: 'PATCH',
        body: JSON.stringify({ requirementIds }),
      })
    )
);

server.registerTool(
  'list_rounds',
  {
    title: '실행 회차 목록 조회',
    description: '세션의 실행 회차(실행 1회, 2회 ...) 목록을 가져옵니다.',
    inputSchema: { sessionId: z.string() },
  },
  async ({ sessionId }) => textResult(await callApi(`/sessions/${sessionId}/rounds`))
);

server.registerTool(
  'get_round_results',
  {
    title: '실행 회차 결과 조회',
    description:
      '특정 실행 회차의 케이스별 결과(Pass/Fail/Blocked/N/A/Not run)를 가져옵니다. 각 결과의 ' +
      'cycleCase.testCase.automationFileName이 있으면(null이 아니면) 자동화 스크립트가 첨부된 ' +
      '케이스이고, run_case_automation으로 그 결과(resultId)를 자동 실행할 수 있습니다.',
    inputSchema: { sessionId: z.string(), roundId: z.string() },
  },
  async ({ sessionId, roundId }) => textResult(await callApi(`/sessions/${sessionId}/rounds/${roundId}/results`))
);

server.registerTool(
  'get_round_test_case_result',
  {
    title: '실행 회차의 케이스 하나의 결과 조회',
    description: 'resultId를 이미 알고 있을 때(run_case_automation/record_result 이후 등) 전체 목록을 다시 받지 않고 그 결과 하나만 조회합니다.',
    inputSchema: { sessionId: z.string(), roundId: z.string(), resultId: z.string() },
  },
  async ({ sessionId, roundId, resultId }) =>
    textResult(await callApi(`/sessions/${sessionId}/rounds/${roundId}/results/${resultId}`))
);

server.registerTool(
  'record_result',
  {
    title: '실행 결과 기록',
    description: '실행 회차의 특정 케이스에 대한 실행 결과를 기록합니다.',
    inputSchema: {
      sessionId: z.string(),
      roundId: z.string(),
      resultId: z.string(),
      status: z.enum(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED', 'NA']),
      comment: z.string().optional(),
    },
  },
  async ({ sessionId, roundId, resultId, status, comment }) =>
    textResult(
      await callApi(`/sessions/${sessionId}/rounds/${roundId}/results/${resultId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, comment }),
      })
    )
);

server.registerTool(
  'list_automation_script_versions',
  {
    title: '자동화 스크립트 이전 버전 조회',
    description: '이 케이스의 자동화 스크립트가 첨부/교체/삭제될 때마다 남는 이전 버전 이력을 조회합니다.',
    inputSchema: { caseId: z.string().describe('list_test_cases로 조회한 테스트 케이스 ID') },
  },
  async ({ caseId }) => textResult(await callApi(`/test-cases/${caseId}/script/versions`))
);

server.registerTool(
  'run_case_automation',
  {
    title: '러너로 자동 실행',
    description:
      '이 케이스에 첨부된 자동화 스크립트를 프로젝트에 연결된 실제 러너에서 실행합니다. ' +
      'record_result로 직접 결과를 기록하는 대신, 실제 러너가 스크립트를 구동한 결과(Pass/Fail)를 그대로 반영합니다. ' +
      '실행이 오래 걸려 시간 내 끝나지 않으면 status: "IN_PROGRESS"와 runId를 반환하니, ' +
      'get_automation_run_status로 다시 확인하세요. JMeter(.jmx)나 Postman/Newman(.json) 스크립트도 ' +
      '실행 가능합니다 — 각각 샘플러/요청·어설션 성공 여부로 Pass/Fail이 판정됩니다. 응답에 포함된 ' +
      'cycleCaseId/roundId는 바로 이 실행이 속한 세션의 케이스/회차이므로, FAIL을 결함으로 등록할 때 ' +
      'create_bug에 다른 도구로 다시 찾지 말고 그대로 넘기세요.',
    inputSchema: { sessionId: z.string(), roundId: z.string(), resultId: z.string() },
  },
  async ({ sessionId, roundId, resultId }) =>
    textResult(
      await callApi(`/sessions/${sessionId}/rounds/${roundId}/results/${resultId}/run-automation`, { method: 'POST' })
    )
);

server.registerTool(
  'get_automation_run_status',
  {
    title: '자동 실행 상태 조회',
    description:
      'run_case_automation이 시간 내에 끝나지 않았을 때, runId로 최종 결과를 다시 확인합니다. ' +
      '응답의 artifacts 목록(스크린샷/영상/.jtl/리포트 등)에서 id를 얻어 get_automation_run_artifact로 ' +
      '실제 파일 내용을 가져올 수 있습니다. 응답에 포함된 cycleCaseId/roundId는 이 실행이 속한 세션의 ' +
      '케이스/회차이므로, FAIL을 결함으로 등록할 때 create_bug에 다른 도구로 다시 찾지 말고 그대로 ' +
      '넘기세요 - list_sessions/list_rounds로 다시 뒤져서 추측하지 마세요.',
    inputSchema: { runId: z.string() },
  },
  async ({ runId }) => textResult(await callApi(`/automation-runs/${runId}`))
);

server.registerTool(
  'get_automation_run_artifact',
  {
    title: '자동 실행 첨부 파일(아티팩트) 가져오기',
    description:
      'run_case_automation/get_automation_run_status 응답의 artifacts 목록에 있는 파일(예: 실패 스크린샷 ' +
      'failure.png, Playwright 영상 .webm, JMeter 결과 .jtl)을 base64로 인코딩해 가져옵니다. ' +
      '10MB를 넘는 파일은 가져올 수 없습니다 — 웹 UI의 실행 탭에서 확인하세요.',
    inputSchema: {
      runId: z.string(),
      artifactId: z.string().describe('get_automation_run_status 응답의 artifacts[].id'),
    },
  },
  async ({ runId, artifactId }) => textResult(await callApi(`/automation-runs/${runId}/artifacts/${artifactId}`))
);

server.registerTool(
  'get_automation_script_guide',
  {
    title: '자동화 스크립트 작성 가이드',
    description:
      'attach_automation_script로 첨부할 스크립트를 작성하기 전에 호출하세요. 각 종류(kind)별 파일 형식, ' +
      '작성 규칙, 실제 동작하는 예시 스크립트를 반환합니다. kind를 생략하면 전체 개요를 반환합니다.',
    inputSchema: {
      kind: z.enum(['NODE_TS', 'JMETER', 'POSTMAN']).optional().describe('가이드를 볼 스크립트 종류 (생략 시 전체 개요)'),
    },
  },
  async ({ kind }) => textResult(kind ? SCRIPT_GUIDES[kind] : SCRIPT_GUIDES.OVERVIEW)
);

server.registerTool(
  'create_bug',
  {
    title: '결함 등록',
    description: '이 프로젝트에 새 결함을 등록합니다.',
    inputSchema: {
      title: z.string(),
      description: z.string().optional(),
      targetSystem: z.string().optional(),
      expectedResult: z.string().optional(),
      actualResult: z.string().optional(),
      reproSteps: z.string().optional(),
      severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      cycleCaseId: z
        .string()
        .optional()
        .describe(
          '연관된 세션 케이스 ID (선택). 자동화 실행 결과로 발견된 결함이면 run_case_automation/' +
            'get_automation_run_status 응답의 cycleCaseId를 그대로 쓰세요 - list_sessions 등으로 다시 찾지 마세요.'
        ),
      roundId: z
        .string()
        .optional()
        .describe(
          '결함이 발견된 실행 사이클(회차) ID (선택). 자동화 실행 결과로 발견된 결함이면 ' +
            'run_case_automation/get_automation_run_status 응답의 roundId를 그대로 쓰세요 - 수동으로 확인한 ' +
            '결함이면 list_rounds로 조회하세요.'
        ),
    },
  },
  async (args) => textResult(await callApi('/bugs', { method: 'POST', body: JSON.stringify(args) }))
);

server.registerTool(
  'list_bugs',
  {
    title: '결함 목록 조회 / 검색',
    description: '이 프로젝트에 등록된 결함 목록을 가져옵니다. 필터를 하나도 넘기지 않으면 전체를 반환합니다.',
    inputSchema: {
      status: z.enum(['OPEN', 'IN_PROGRESS', 'FIXED', 'CLOSED']).optional(),
      severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      q: z.string().optional().describe('ID/제목/설명/실제결과에 포함된 검색어 (대소문자 무시)'),
    },
  },
  async ({ status, severity, priority, q } = {}) =>
    textResult(await callApi(`/bugs${qs({ status, severity, priority, q })}`))
);

server.registerTool(
  'get_bug',
  {
    title: '결함 상세 조회',
    description: '결함 하나의 전체 상세를 가져옵니다.',
    inputSchema: { bugId: z.string().describe('list_bugs/create_bug로 조회한 결함 ID') },
  },
  async ({ bugId }) => textResult(await callApi(`/bugs/${bugId}`))
);

server.registerTool(
  'update_bug',
  {
    title: '결함 수정',
    description:
      '결함의 필드를 수정하거나 상태를 전이시킵니다(OPEN→IN_PROGRESS→FIXED→CLOSED). 전달한 필드만 ' +
      '바뀌고 나머지는 유지되며, 수정 전 상태는 이전 버전 이력으로 자동 보존됩니다.',
    inputSchema: {
      bugId: z.string().describe('list_bugs/create_bug로 조회한 결함 ID'),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      targetSystem: z.string().nullable().optional(),
      expectedResult: z.string().nullable().optional(),
      actualResult: z.string().nullable().optional(),
      reproSteps: z.string().nullable().optional(),
      severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'FIXED', 'CLOSED']).optional(),
      roundId: z.string().nullable().optional().describe('연관된 실행 사이클(회차) ID (list_rounds로 조회, null이면 연결 해제)'),
      cycleCaseId: z.string().nullable().optional().describe('연관된 세션 케이스 ID (list_session_cases로 조회, null이면 연결 해제)'),
    },
  },
  async ({ bugId, ...patch }) => textResult(await callApi(`/bugs/${bugId}`, { method: 'PATCH', body: JSON.stringify(patch) }))
);

server.registerTool(
  'list_runners',
  {
    title: '연결된 러너 조회',
    description:
      '이 프로젝트에 배정된 러너(자동화 실행 에이전트)와 온라인 여부, 실행 가능한 스크립트 종류 ' +
      '(capabilities: NODE_TS/JMETER/POSTMAN/APPIUM/OWASP_ZAP)를 조회합니다. run_case_automation 호출 전 ' +
      '실행 가능한 러너가 있는지 미리 확인할 때 씁니다.',
    inputSchema: {},
  },
  async () => textResult(await callApi('/runners'))
);

server.registerTool(
  'get_project_summary',
  {
    title: '프로젝트 현황 요약',
    description:
      '테스트 케이스 수, 요구사항 수와 커버리지, 세션 수, 상태별 결함 수를 한 번에 조회합니다. ' +
      '여러 list_* 도구를 조합하지 않고 프로젝트 전반 현황을 빠르게 파악할 때 씁니다.',
    inputSchema: {},
  },
  async () => textResult(await callApi('/summary'))
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcp] OTestManager2026 MCP server ready (stdio)');
