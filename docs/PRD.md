# PRD: AI Document Audit Repeat — Chrome Extension

**Version:** 2.0.0 · **Status:** Draft · **Date:** March 2026

> Chrome Extension for Automated Iterative Document Review on Claude.ai

---

## Table of Contents

1. [Executive Summary](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#1-executive-summary)
2. [Product Overview](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#2-product-overview)
3. [System Architecture](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#3-system-architecture)
4. [Functional Requirements](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#4-functional-requirements)
5. [Non-Functional Requirements](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#5-non-functional-requirements)
6. [Detailed Use Cases](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#6-detailed-use-cases)
7. [Configuration Parameters](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#7-configuration-parameters)
8. [Risks &amp; Mitigations](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#8-risks--mitigations)
9. [Permissions &amp; Security](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#9-permissions--security)
10. [DOM Selector Reference](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#10-dom-selector-reference)
11. [Future Roadmap](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#11-future-roadmap)
12. [Technical Constraints &amp; Dependencies](https://claude.ai/chat/846c47be-4caa-4176-924d-9e034c829578#12-technical-constraints--dependencies)

---

## 1. Executive Summary

### 1.1 Problem Statement

Khi làm việc với tài liệu dài như business plan, chiến lược, hoặc báo cáo kỹ thuật, việc review và revise nhiều vòng là tất yếu. Tuy nhiên, hiện tại người dùng Claude.ai phải thực hiện thủ công từng bước: copy response, mở chat mới, paste lại tài liệu kèm prompt, gửi, đợi, rồi lặp lại. Quy trình này tốn thời gian, dễ nhầm, và làm gián đoạn tư duy.

### 1.2 Proposed Solution

Xây dựng Chrome Extension tên "AI Document Audit Repeat" cho phép tự động hóa chu trình review/revise tài liệu N vòng trên Claude.ai. Extension hoạt động trực tiếp trên giao diện Claude web, giữ nguyên chất lượng output của Claude và không phát sinh chi phí API riêng.

### 1.3 Key Value Propositions

* **Giữ nguyên chất lượng Claude web:** Không sử dụng API riêng, output được tạo bởi chính Claude web với system prompt gốc của Anthropic.
* **Tự động hoàn toàn:** Chỉ cần chạy query đầu tiên bằng tay, extension tự động thực hiện các vòng tiếp theo.
* **Không ảnh hưởng workflow:** Chạy trong một tab cố định, người dùng tự do làm việc ở các tab khác.
* **Không chi phí thêm:** Sử dụng chung quota của plan Claude (Pro/Free) hiện tại.

---

## 2. Product Overview

### 2.1 Target Users

| Persona       | Mô tả                                            | Nhu cầu chính                                              |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Consultant    | Tư vấn chiến lược, làm plan cho khách hàng | Review nhiều vòng để đạt chất lượng chuyên nghiệp |
| Founder/PM    | Viết business plan, product spec                  | Iterative refinement từ draft đến final                   |
| Researcher    | Viết báo cáo kỹ thuật, paper                  | Cải thiện logic và cấu trúc qua nhiều lần             |
| Writer/Editor | Viết long-form content                            | Polish văn phong và nội dung qua nhiều pass              |

### 2.2 User Journey

Quy trình sử dụng extension được thiết kế theo 4 giai đoạn:

#### Phase 1: Manual First Run

Người dùng mở Claude.ai (trong project nếu cần), gửi prompt review đầu tiên cùng tài liệu gốc, và đợi Claude trả lời xong. Đây là bước thủ công duy nhất, đảm bảo người dùng kiểm soát prompt đầu vào và chất lượng vòng 1.

#### Phase 2: Configure Extension

Người dùng mở popup extension, nhập prompt review (sẽ dùng lặp lại cho các vòng sau), chọn số vòng N, và tùy chỉnh các tham số nâng cao nếu cần.

#### Phase 3: Automated Execution

Extension tự động trích xuất V1, navigate sang chat mới (cùng project), nhập prompt + tài liệu, gửi, đợi response, lưu V2, và lặp lại cho đến vòng N. Người dùng có thể theo dõi tiến trình real-time qua popup.

#### Phase 4: Review & Download

Sau khi hoàn thành, người dùng có N phiên bản để so sánh. Có thể tải từng phiên bản hoặc tải tất cả dưới dạng .md files.

---

## 3. System Architecture

### 3.1 Design Principles

* **Tab-locked execution:** Extension chỉ thao tác trên một tab ID cố định, không ảnh hưởng các tab khác.
* **State survives navigation:** Service worker giữ toàn bộ state, không bị mất khi tab navigate.
* **Separation of concerns:** Logic điều phối tách biệt khỏi DOM interaction.
* **Resilient selectors:** Nhiều fallback selectors cho mỗi element, dễ cập nhật khi UI thay đổi.

### 3.2 Three-Layer Architecture

| Layer                   | File                              | Trách nhiệm                                                                                                                   |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestrator**  | `background.js`(Service Worker) | Giữ state, quản lý tab ID, điều phối chu trình, poll response, broadcast state. Sống độc lập với tab.               |
| **DOM Agent**     | `content.js`(Content Script)    | Chỉ tương tác DOM: đọc response, nhập text vào editor, click Send, kiểm tra trạng thái streaming. Không giữ state. |
| **Control Panel** | `popup.html`+`popup.js`       | Giao diện người dùng: hiển thị trạng thái, nhận lệnh, hiển thị versions, cho phép download.                        |

### 3.3 Communication Flow

Các lớp giao tiếp qua Chrome Messaging API:

* **Popup → Background:** Gửi lệnh (START, PAUSE, RESET, GET_STATE)
* **Background → Content:** Gửi tác vụ DOM (EXTRACT_RESPONSE, TYPE_TEXT, CLICK_SEND, CHECK_STATUS) qua `chrome.tabs.sendMessage(tabId, ...)`
* **Background → Popup:** Broadcast state updates qua `chrome.runtime.sendMessage`
* **Content → Background:** Trả kết quả DOM operations qua `sendResponse` callback

### 3.4 State Management

Toàn bộ state được quản lý tập trung tại `background.js`:

| Field            | Type   | Mô tả                                                  |
| ---------------- | ------ | -------------------------------------------------------- |
| `status`       | enum   | `idle`                                                 |
| `tabId`        | number | ID của tab Claude.ai đang được điều khiển        |
| `reviewPrompt` | string | Prompt review dùng lặp lại cho các vòng sau vòng 1 |
| `totalRounds`  | number | Tổng số vòng cần chạy (bao gồm vòng 1 thủ công) |
| `currentRound` | number | Vòng hiện tại đang xử lý                           |
| `versions[]`   | array  | Mảng chứa `{ round, content, charCount, timestamp }` |
| `projectUrl`   | string | URL project để navigate chat mới trong cùng project  |
| `logs[]`       | array  | Lịch sử log `{ ts, msg, level }`cho debug            |
| `config`       | object | Các tham số timing (delays, poll interval, timeout)    |

---

## 4. Functional Requirements

### 4.1 Core Features

#### FR-1: Tab Detection & Locking

1. **Detect tab:** Khi mở popup, extension tự động detect tab Claude.ai đang active.
2. **Lock tab:** Khi nhấn Start, lưu tab ID và chỉ thao tác trên tab đó suốt chu trình.
3. **Validate tab:** Trước mỗi thao tác, verify tab vẫn tồn tại và đang ở claude.ai domain.
4. **Project awareness:** Tự động detect project URL từ tab hiện tại để mở chat mới trong cùng project.

#### FR-2: Response Extraction

1. **Multi-strategy extraction:** Dùng 3+ strategies để tìm response container (conversation turns, prose elements, message blocks).
2. **Text extraction:** Lấy `innerText` từ container cuối cùng (response mới nhất của Claude).

#### FR-3: Editor Interaction

1. **Multi-method input:** 3 phương pháp nhập text: `execCommand`, innerHTML manipulation, clipboard paste. Fallback tuần tự.
2. **ProseMirror compatible:** Dispatch các events (`input`, `change`, `keyup`) để ProseMirror editor nhận diện thay đổi.
3. **Send button detection:** Nhiều selectors + heuristic fallback (`aria-label`, fieldset structure).
4. **Disabled button handling:** Chờ tối đa 6 giây nếu nút Send đang disabled.

#### FR-4: Response Polling

1. **Generation detection:** Kiểm tra stop button visibility và streaming attribute.
2. **Stability check:** Response phải stable (không thay đổi) qua N lần poll liên tiếp (mặc định 3).
3. **Configurable timeout:** Mặc định 10 phút, có thể tăng cho tài liệu dài.
4. **Content script retry:** Tự động re-inject content script nếu mất kết nối sau navigation (tối đa 8 lần).

#### FR-5: Cycle Management

1. **Start:** Validate inputs, lock tab, bắt đầu chu trình.
2. **Pause:** Dừng sau vòng hiện tại hoàn thành, giữ lại versions đã lưu.
3. **Reset:** Xóa state, quay về idle.
4. **Error recovery:** Hiển thị lỗi cụ thể, giữ versions đã hoàn thành để download.

#### FR-6: Version Management

1. **Auto-save:** Lưu mỗi version vào state ngay khi response stable.
2. **Download individual:** Tải từng version dưới dạng `revision_vN.md`.
3. **Download all:** Tải tất cả versions cùng lúc.
4. **Persistent prompt:** Lưu prompt và số vòng vào `chrome.storage.local`.

---

## 5. Non-Functional Requirements

| ID    | Yêu cầu                                                      | Metric                 | Priority     |
| ----- | -------------------------------------------------------------- | ---------------------- | ------------ |
| NFR-1 | Extension không làm chậm Claude.ai khi idle                 | < 5ms overhead         | **P0** |
| NFR-2 | Content script inject thành công sau navigation              | ≤ 8 retries, ≤ 12s   | **P0** |
| NFR-3 | State không bị mất khi tab navigate                         | 100% qua các vòng    | **P0** |
| NFR-4 | Hỗ trợ tài liệu dài (> 10,000 từ)                        | Timeout đến 10 phút | **P1** |
| NFR-5 | Popup responsive để theo dõi trên màn hình nhỏ          | 380px width            | **P1** |
| NFR-6 | Debug info đủ để troubleshoot selector issues              | ≤ 1 click             | **P1** |
| NFR-7 | Sử dụng Manifest V3 để đảm bảo tương thích lâu dài | V3 compliance          | **P0** |

---

## 6. Detailed Use Cases

### UC-1: Happy Path — Full Cycle Completion

1. Người dùng mở Claude.ai trong project "Q2 Strategy".
2. Gửi prompt: "Hãy review và cải thiện tài liệu này..." kèm tài liệu gốc. Đợi Claude trả lời.
3. Mở popup extension. Hệ thống tự detect tab và hiển thị thông tin.
4. Nhập prompt review, chọn 4 vòng, nhấn Start.
5. Extension trích xuất V1 từ response hiện tại.
6. Extension navigate sang chat mới trong cùng project.
7. Extension nhập prompt + V1 vào editor, click Send.
8. Extension poll cho đến khi response stable, lưu V2.
9. Lặp lại bước 6–8 cho V3, V4.
10. Hiển thị "✓ Xong". Người dùng tải 4 files.

### UC-2: Pause & Resume

Ở vòng 3/5, người dùng nhấn Pause. Extension dừng sau khi V3 hoàn thành. Người dùng có thể tải V1–V3 hoặc Reset để bắt đầu lại.

### UC-3: Error — Tab Closed

Nếu người dùng vô tình đóng tab đang chạy, `background.js` detect lỗi khi cố gửi message, chuyển status sang error, và giữ lại các versions đã hoàn thành để download.

### UC-4: Error — DOM Selector Broken

Nếu Claude.ai cập nhật UI và selectors không tìm được element, extension hiện lỗi cụ thể trong log. Người dùng click Debug selectors để xác định vấn đề và cập nhật selectors trong `content.js`.

---

## 7. Configuration Parameters

| Parameter             | Default   | Range          | Mô tả                                              |
| --------------------- | --------- | -------------- | ---------------------------------------------------- |
| `DELAY_AFTER_NAV`   | 4000 ms   | 2000–10000    | Thời gian chờ sau khi navigate sang chat mới      |
| `DELAY_BEFORE_SEND` | 800 ms    | 300–3000      | Thời gian chờ trước khi click Send               |
| `DELAY_AFTER_SEND`  | 3000 ms   | 1000–10000    | Thời gian chờ sau Send trước khi bắt đầu poll |
| `POLL_INTERVAL`     | 2500 ms   | 1000–5000     | Tần suất kiểm tra response                        |
| `POLL_TIMEOUT`      | 600000 ms | 60000–1200000 | Thời gian tối đa chờ response (10 phút)         |
| `STABLE_CHECKS`     | 3         | 2–5           | Số lần poll liên tiếp response không thay đổi |

---

## 8. Risks & Mitigations

| #  | Risk                                                         | Impact           | Mitigation                                                                                                        |
| -- | ------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1 | Claude.ai UI thay đổi làm hỏng selectors                 | **High**   | Multi-fallback selectors, debug tool, hướng dẫn user tự cập nhật. Selector config tập trung ở đầu file. |
| R2 | Service worker bị Chrome terminate khi idle                 | **Medium** | Duy trì hoạt động bằng các message giữa background và content script trong chu trình.                    |
| R3 | ProseMirror reject text input                                | **Medium** | 3 phương pháp fallback (execCommand, innerHTML, clipboard). Mỗi method dispatch đủ events.                  |
| R4 | Rate limit từ Claude.ai khi gửi nhiều messages liên tục | **Medium** | Configurable delays giữa các vòng. User được hướng dẫn chọn số vòng hợp lý (3–5).                  |
| R5 | Tài liệu quá dài vượt context window                   | **Low**    | Giới hạn nằm ở phía Claude, không nằm ở extension. Khuyến nghị tài liệu < 15,000 từ.                 |
| R6 | User đóng tab đang chạy                                  | **Low**    | Background detect lỗi, chuyển sang error state, giữ versions đã hoàn thành.                                |

---

## 9. Permissions & Security

### 9.1 Chrome Permissions

| Permission            | Lý do                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| `storage`           | Lưu prompt và cài đặt của user qua các session                              |
| `tabs`              | Detect tab hiện tại, navigate tab, gửi message đến content script theo tab ID |
| `scripting`         | Re-inject content script sau khi tab navigate (fallback mechanism)                 |
| `host: claude.ai/*` | Chỉ hoạt động trên claude.ai, không truy cập domain khác                   |

### 9.2 Security Principles

* **Minimal permissions:** Chỉ yêu cầu permissions tối thiểu cần thiết.
* **No external requests:** Extension không gửi data ra ngoài. Mọi thao tác diễn ra local và trên claude.ai.
* **No API keys:** Không lưu trữ hay sử dụng API keys.
* **Domain-restricted:** Content script chỉ inject vào claude.ai.

---

## 10. DOM Selector Reference

Các selectors được tập trung trong `content.js` phần `SEL` object. Mỗi element có nhiều fallback selectors được thử tuần tự:

| Element           | Selectors (theo thứ tự ưu tiên)                         | Mục đích       |
| ----------------- | ----------------------------------------------------------- | ----------------- |
| `editor`        | `ProseMirror[contenteditable]`,`div[contenteditable]`   | Nhập text        |
| `sendButton`    | `aria-label="Send Message"`,`data-testid="send-button"` | Gửi message      |
| `stopButton`    | `aria-label="Stop Response"`,`aria-label="Stop"`        | Detect generation |
| `messageGroups` | `data-testid="conversation-turn"`,`data-is-streaming`   | Đọc response    |

> *Lưu ý: Các selectors có thể cần cập nhật khi Claude.ai thay đổi UI. Sử dụng Debug selectors để kiểm tra.*

---

## 11. Future Roadmap

### 11.1 Phase 2 — Short Term

* **Diff viewer:** So sánh trực tiếp giữa các versions (side-by-side diff) ngay trong popup.
* **Custom prompt per round:** Cho phép prompt khác nhau cho mỗi vòng (ví dụ: vòng 1 focus logic, vòng 2 focus ngôn ngữ).
* **Resume from pause:** Cho phép tiếp tục từ vòng đã dừng thay vì phải chạy lại.

### 11.2 Phase 3 — Medium Term

* **Version comparison report:** Tự động tạo báo cáo tóm tắt thay đổi giữa các versions.
* **Project template:** Lưu bộ prompt + config như template để dùng lại.
* **Export formats:** Hỗ trợ xuất .docx, .pdf ngoài .md.

### 11.3 Phase 4 — Long Term

* **Selector auto-repair:** Tự động detect và suggest selectors mới khi DOM thay đổi.
* **Multi-document cycle:** Chạy cycle cho nhiều tài liệu song song.
* **Quality scoring:** Tự động đánh giá chất lượng improvement giữa các versions.

---

## 12. Technical Constraints & Dependencies

### 12.1 Browser Requirements

* Chrome/Chromium-based browsers (Edge, Brave, Arc)
* Manifest V3 support (Chrome 88+)
* Service Worker API support

### 12.2 External Dependencies

* **Claude.ai DOM structure:** Extension phụ thuộc vào HTML structure hiện tại của Claude.ai. Đây là rủi ro chính.
* **Claude.ai account:** Người dùng cần tài khoản Claude (Free hoặc Pro). Số vòng khả dụng phụ thuộc vào message quota của plan.
* **Network:** Cần kết nối internet ổn định suốt chu trình.

### 12.3 Known Limitations

* Không hỗ trợ file attachments (chỉ text content).
* Không detect được nếu Claude từ chối trả lời (safety filters).
* Service worker có thể bị Chrome terminate sau 5 phút idle (mitigation: hoạt động liên tục trong chu trình).
* Background tab throttling có thể làm chậm poll (mitigation: tab được navigate nên vẫn active).

---

*End of Document*
