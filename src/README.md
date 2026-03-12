# Claude Review Cycle — Chrome Extension v2

Tự động hóa chu trình review/revise tài liệu trên Claude.ai. Extension chạy trong **một tab cố định**, bạn tự do làm việc ở các tab khác.

## Kiến trúc

```
background.js   ← Bộ não: giữ state, quản lý tab ID, điều phối chu trình
    ↕ messages
content.js      ← Tay chân: chỉ tương tác DOM (đọc response, nhập text, click send)
    ↕ messages
popup.html/js   ← Control panel: hiển thị trạng thái, nhận lệnh từ user
```

**Tại sao kiến trúc này?**
- `background.js` (service worker) **không bị mất** khi tab navigate sang chat mới
- Nó giữ tab ID cố định, gửi lệnh xuống content script qua `chrome.tabs.sendMessage(tabId, ...)`
- Bạn có thể làm việc ở tab khác — extension chỉ thao tác trên tab đã lock

## Cài đặt

1. Giải nén file zip
2. Chrome → `chrome://extensions/`
3. Bật **Developer mode** (góc phải trên)
4. **Load unpacked** → chọn thư mục `claude-review-cycle-ext`
5. Pin extension lên toolbar để dễ truy cập

## Cách sử dụng

### Bước 1: Chạy query đầu tiên bằng tay
- Mở Claude.ai (trong project nếu muốn)
- Gửi prompt review với tài liệu gốc
- Đợi Claude trả lời xong

### Bước 2: Mở extension popup
- Click icon extension trên toolbar
- Extension tự detect tab Claude.ai đang active
- Nhập **prompt review** (sẽ dùng lặp lại cho mỗi vòng sau)
- Chọn **số vòng** (tổng cộng, bao gồm cả vòng 1 đã chạy tay)

### Bước 3: Nhấn ▶ Bắt đầu
Extension sẽ tự động:
1. Trích xuất response hiện tại → V1
2. Navigate tab đó sang chat mới (cùng project)
3. Nhập prompt + V1 vào editor → gửi
4. Đợi Claude trả lời → lưu V2
5. Lặp lại cho đến vòng N

### Bước 4: Tải kết quả
- Click vào từng version trong popup để download
- Hoặc nhấn **↓ Tải tất cả**

## Lưu ý

### Tab management
- Extension lock vào tab ID khi bạn nhấn Start
- Tab đó sẽ bị navigate qua các chat mới — **đừng đóng tab đó**
- Bạn tự do làm việc ở các tab khác

### Nếu extension không hoạt động
1. Click **Debug selectors** trong popup
2. Xem element nào bị `✕`
3. Mở DevTools (F12) → inspect element tương ứng trên Claude.ai
4. Cập nhật selectors trong `content.js` phần `SEL`

### Cài đặt nâng cao
- **Delay sau navigate**: tăng nếu mạng chậm (mặc định 4000ms)
- **Poll interval**: tần suất kiểm tra response (mặc định 2500ms)
- **Poll timeout**: thời gian tối đa chờ response (mặc định 10 phút)
- **Stable checks**: response phải ổn định bao nhiêu lần trước khi coi là xong

## Cấu trúc file

```
claude-review-cycle-ext/
├── manifest.json   # Extension manifest v3
├── background.js   # Service worker — orchestration
├── content.js      # Content script — DOM interaction
├── popup.html      # Popup UI
├── popup.js        # Popup logic
├── icon.png        # Extension icon
└── README.md
```
