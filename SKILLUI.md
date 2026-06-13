# Cẩm nang Thiết kế & Lập trình Giao diện (UI/UX) Đa Nền Tảng (CSS, React, Next.js, Tailwind)

Tài liệu này tổng hợp toàn bộ các kỹ thuật thiết kế, biến CSS, cấu trúc layout, hiệu ứng cao cấp và logic tương tác được viết dưới dạng **Đa Nền Tảng**. Bạn có thể dễ dàng áp dụng bộ khung này vào các dự án **Vanilla HTML/CSS/JS** truyền thống lẫn các framework hiện đại như **React.js, Next.js, Vue, Svelte** và thư viện **Tailwind CSS**.

---

## 1. Hệ thống Biến CSS & Cấu hình Tailwind CSS (Design Tokens)

Design Tokens giúp đảm bảo tính đồng nhất về màu sắc và kiểu chữ trên toàn bộ ứng dụng của bạn, bất kể bạn dùng CSS thuần hay Tailwind.

### Cách 1: Sử dụng CSS Custom Variables (Dùng cho mọi dự án, Next.js, React, CSS Modules)
Đặt mã này vào file CSS toàn cục (ví dụ: `globals.css` hoặc `style.css`):
```css
:root {
  /* --- Bảng màu chính (Dark Theme) --- */
  --bg: #07090b;
  --bg-alt: #101317;
  --surface: rgba(255, 255, 255, 0.08);
  --surface-strong: rgba(255, 255, 255, 0.14);
  --text: #f8f3e8;
  --text-soft: #d9cfbd;
  --text-muted: #a79c8c;
  --line: rgba(248, 243, 232, 0.16);

  /* --- Bảng màu giấy (Paper Theme - Thích hợp cho khối nội dung dài) --- */
  --paper: #f6f0e3;
  --paper-soft: #efe3cb;
  --ink: #17120f;
  --ink-soft: #5c5146;
  --dark-line: rgba(23, 18, 15, 0.12);

  /* --- Màu điểm nhấn --- */
  --red: #d85042;
  --amber: #e4ad4a;
  --teal: #43b4a5;

  /* --- Typography --- */
  --font-label: "Inter", system-ui, sans-serif;
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-serif: "Newsreader", Georgia, serif;
}
```

### Cách 2: Cấu hình ánh xạ sang Tailwind CSS (`tailwind.config.js`)
Nếu dự án React/Next.js của bạn dùng Tailwind, hãy đưa các Token này vào file cấu hình để dùng dưới dạng các class như `bg-brand-red`, `text-brand-textSoft`, `font-serif`:
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: 'var(--bg)',
          bgAlt: 'var(--bg-alt)',
          surface: 'var(--surface)',
          surfaceStrong: 'var(--surface-strong)',
          text: 'var(--text)',
          textSoft: 'var(--text-soft)',
          textMuted: 'var(--text-muted)',
          line: 'var(--line)',
          paper: 'var(--paper)',
          paperSoft: 'var(--paper-soft)',
          ink: 'var(--ink)',
          inkSoft: 'var(--ink-soft)',
          red: 'var(--red)',
          amber: 'var(--amber)',
          teal: 'var(--teal)',
        }
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        serif: ['var(--font-serif)', 'serif'],
        label: ['var(--font-label)', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
```

---

## 2. Kỹ thuật Phối màu Luân phiên (Section-based Theme Switcher)

Khi thiết kế một trang Landing Page dài, việc thay đổi màu nền xen kẽ giữa các Section (Dark và Light/Paper) giúp cải thiện trải nghiệm đọc, chống mỏi mắt.

### CSS toàn cục:
```css
.theme-dark {
  background: var(--bg);
  color: var(--text);
}
.theme-paper {
  background: var(--paper);
  color: var(--ink);
}
```

### Cách dùng trong React / Next.js:
```jsx
export default function App() {
  return (
    <main>
      {/* Section 1: Dark */}
      <section className="theme-dark py-20">
        <div className="container">
          <h2 className="font-display text-4xl">Giao diện tối huyền bí</h2>
        </div>
      </section>

      {/* Section 2: Paper */}
      <section className="theme-paper py-20">
        <div className="container">
          <h2 className="font-serif italic text-4xl">Giao diện nền giấy cổ điển</h2>
        </div>
      </section>
    </main>
  );
}
```

---

## 3. Tạo Hiệu ứng Nền Cao cấp (Glassmorphism & Radial Glowing Backgrounds)

Sử dụng dải màu `radial-gradient` đa điểm kết hợp với hạt nhiễu để tạo chiều sâu giao diện giống như các trang web cao cấp của Apple, Vercel hay Linear.

### CSS toàn cục:
```css
/* Hiệu ứng kính mờ (Glassmorphism) */
.glass-panel {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Ánh sáng Neon phát quang ở nền (Glow Effect) */
.neon-glow-bg {
  background:
    radial-gradient(circle at 15% 20%, rgba(67, 180, 165, 0.12), transparent 30%),
    radial-gradient(circle at 85% 30%, rgba(216, 80, 66, 0.14), transparent 25%),
    var(--bg);
}

/* Hiệu ứng nền chấm hạt li ti (Noise Overlay) */
.noise-overlay {
  position: absolute;
  inset: 0;
  opacity: 0.12;
  background-image: radial-gradient(circle, var(--text-soft) 1px, transparent 1px);
  background-size: 20px 20px;
  mask-image: linear-gradient(to bottom, black, transparent);
  pointer-events: none;
}
```

### Component React mẫu:
```jsx
export function PremiumHero() {
  return (
    <section className="relative neon-glow-bg min-h-screen flex items-center justify-center overflow-hidden">
      {/* Lớp phủ hạt nhiễu hạt */}
      <div className="noise-overlay" aria-hidden="true" />
      
      <div className="container relative z-10">
        <div className="glass-panel p-10 rounded-2xl max-w-2xl mx-auto text-center">
          <h1 className="font-display text-5xl text-brand-text mb-4">
            Thiết kế tối giản, hiệu quả tối đa
          </h1>
          <p className="font-serif text-brand-textSoft text-lg">
            Sự kết hợp hoàn hảo giữa thẩm mỹ và hiệu năng ứng dụng.
          </p>
        </div>
      </div>
    </section>
  );
}
```

---

## 4. Hiệu ứng Cuộn xuất hiện (Scroll Reveal Component) trong React

Trong Vanilla JS, chúng ta dùng `IntersectionObserver` thủ công trên DOM. Trong React, chúng ta đóng gói logic này thành một Component tái sử dụng cao cấp `<Reveal>` để bọc bất cứ thẻ nào cần chuyển động.

### CSS Setup:
```css
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 650ms cubic-bezier(0.16, 1, 0.3, 1), transform 650ms cubic-bezier(0.16, 1, 0.3, 1);
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
```

### React Component:
```jsx
import { useEffect, useRef, useState } from "react";

export function Reveal({ children, delay = 0, className = "" }) {
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target); // Ngừng theo dõi khi đã xuất hiện để tối ưu hiệu năng
        }
      },
      {
        threshold: 0.1, // Xuất hiện khi phần tử hiện diện 10% trên màn hình
        rootMargin: "0px 0px -40px 0px",
      }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={elementRef}
      className={`reveal ${isVisible ? "visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
```

### Cách sử dụng trong dự án React:
```jsx
import { Reveal } from "./Reveal";

export function ProductFeatures() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Reveal delay={0}>
        <div className="card">Tính năng 1</div>
      </Reveal>
      <Reveal delay={100}>
        <div className="card">Tính năng 2 (hiện sau 100ms)</div>
      </Reveal>
      <Reveal delay={200}>
        <div className="card">Tính năng 3 (hiện sau 200ms)</div>
      </Reveal>
    </div>
  );
}
```

---

## 5. Bộ chuyển đổi Tab so le (Staggered Tabs) bằng State trong React

Logic chuyển tab kết hợp hiệu ứng xuất hiện tuần tự (staggered animation) cho các phần tử con bên trong.

### CSS Setup (Cho chuyển động so le):
```css
.stagger-item {
  opacity: 0;
  transform: translateY(16px);
  animation: staggerFadeIn 500ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes staggerFadeIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### React Component:
```jsx
import { useState } from "react";

export function StaggeredTabs() {
  const [activeTab, setActiveTab] = useState("tab-a");

  const tabData = {
    "tab-a": [
      "Bước 1: Thiết kế giao diện bằng Figma",
      "Bước 2: Xây dựng cấu trúc bằng React Component",
      "Bước 3: Tối ưu hiệu năng và khả năng truy cập",
    ],
    "tab-b": [
      "Bước A: Khởi chạy máy chủ ảo hóa Cloud",
      "Bước B: Cấu hình CDN toàn cầu tăng tốc tải trang",
      "Bước C: Thiết lập CI/CD tự động deploy dự án",
    ],
  };

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Bộ nút chọn tab */}
      <div className="flex gap-2 mb-6" role="tablist">
        {Object.keys(tabData).map((tabId) => (
          <button
            key={tabId}
            role="tab"
            aria-selected={activeTab === tabId}
            onClick={() => setActiveTab(tabId)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === tabId
                ? "bg-brand-red text-white"
                : "bg-brand-surface text-brand-textSoft hover:bg-brand-surfaceStrong"
            }`}
          >
            {tabId === "tab-a" ? "Quy trình thiết kế" : "Quy trình triển khai"}
          </button>
        ))}
      </div>

      {/* Vùng hiển thị nội dung chứa chuyển động so le */}
      <div className="space-y-3">
        {tabData[activeTab].map((text, index) => (
          <div
            key={`${activeTab}-${index}`} // Đổi key khi đổi tab để kích hoạt lại hoạt ảnh
            className="stagger-item p-4 bg-brand-bgAlt border border-brand-line rounded-lg text-brand-textSoft"
            style={{ animationDelay: `${index * 80}ms` }} /* So le nhau 80ms */
          >
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 6. Nút Quay Lên Đầu Trang (Back-To-Top) Đóng Gói Tái Sử Dụng

Component này theo dõi vị trí cuộn chuột của trình duyệt để ẩn/hiện nút hợp lý và cuộn đầu trang một cách mượt mà.

### React Component:
```jsx
import { useEffect, useState } from "react";

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Hiện nút khi người dùng cuộn xuống quá 400px
      setIsVisible(window.scrollY > 400);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <button
      onClick={scrollToTop}
      aria-label="Quay lại đầu trang"
      className={`fixed bottom-6 right-6 z-50 flex items-center justify-center w-12 h-12 rounded-full border border-brand-line bg-brand-bg/80 backdrop-blur text-brand-text shadow-lg transition-all duration-300 ${
        isVisible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-4 pointer-events-none"
      } hover:bg-brand-red hover:border-brand-red`}
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      </svg>
    </button>
  );
}
```

---

## 7. Khả Năng Tương Thích & Trải Nghiệm Người Dùng (UX) Nâng Cao

### Giảm chuyển động (CSS và Tailwind)
Để tối ưu hóa giao diện cho thiết bị cấu hình yếu hoặc người dùng nhạy cảm với chuyển động, hãy luôn thêm đoạn cấu hình tắt transition này:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

### Đọc Screen Reader (A11y)
Khi lập trình React, luôn tuân thủ việc đặt `aria-hidden="true"` cho các Icon trang trí và cung cấp đầy đủ `aria-label` cho các nút chỉ chứa Icon.
```jsx
{/* Đúng kỹ thuật ARIA */}
<button aria-label="Đóng bảng tin">
  <span aria-hidden="true">×</span>
</button>
```
