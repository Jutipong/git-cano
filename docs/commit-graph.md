# Commit Graph — สถาปัตยกรรม & แนวทางปรับปรุงความสวย

เอกสารนี้อธิบายว่ากราฟ commit ที่ใช้อยู่ตอนนี้ทำงานอย่างไร (อิงจากข้อมูลจริงในโค้ด)
แล้วรวบรวมไอเดียที่สามารถทำให้ดูสวย/อ่านง่ายขึ้น พร้อมจุดที่ต้องแก้และความยาก/ง่าย

---

## 1. ภาพรวมสถาปัตยกรรม

ข้อมูลกราฟไหลตามแนวเดียวกับแอปทั้งหมด:

```
git log --all  (src/main/git.ts)
   → CommitNode[]  (shared/types.ts)
   → useRepoStore → ผ่าน props ลง GraphView.vue
   → render: SVG canvas (lane/เส้น/จุด) + HTML rows (ข้อความ/chip)
```

- **ไฟล์หลัก**: `src/renderer/src/components/GraphView.vue`
- **สไตล์**: `styles.css` (base) + `modern-ui.css` (override ลุค/ฟิลหลัง)
- **สี/รูปแบบโทน**: วาดด้วย SVG `<canvas>` กับ `<g>`; ข้อความและ chip เป็น HTML
  ธรรมดาวางทับบน grid ของ `.graph-row`

### ข้อมูล `CommitNode`
```ts
interface CommitNode {
    hash, shortHash, parents: string[]
    author, date, subject, body?
    refs: string[]        // เช่น ["HEAD -> main", "origin/main", "tag: v1.0"]
    lane: number          // ตำแหน่งคอลัมน์ของ commit ในกราฟ
}
```

`lane` ถูกกำหนดใน `src/main/git.ts` ด้วย `assignLanes()` (first-parent lane
allocator) — commit ในสายแรกของ branch เดียวกันจะได้ lane เดียวกัน

---

## 2. การวาดกราฟ

### 2.1 ค่าคงที่สำคัญ (`GraphView.vue`)
```ts
const laneW = 24   // ความกว้าง 1 คอลัมน์ (px)
const rowH  = 28   // ความสูง 1 บรรทัด (px)
const COLORS = ['#35c6b0','#5b9cf6','#b78af7','#f2a65a','#ef6b73','#4fc3d8','#e3bd55','#ef82b8'] // 8 สีวนซ้ำ
const graphW = (maxLane+1) * laneW + 20   // ความกว้างรวมของบริเวณ lane
```

### 2.2 ตำแหน่งจุด (node)
```ts
nodeX(c) = c.lane * laneW + laneW/2          // กลางคอลัมน์
nodeY(i) = i * rowH + rowH/2                 // กลางบรรทัด
nodeColor(c) = COLORS[c.lane % COLORS.length]
```

### 2.3 เส้นเชื่อม (edge)
เส้นครอบครัวเชื่อมระหว่าง commit กับ parent ด้วย bezier curve 2 จุดควบคุม:

```
M nodeX(commit) nodeY(index)
C nodeX(commit) nodeY(index) + rowH*0.55,          // คุมขึ้น-ลงจากลูก
  nodeX(parent) nodeY(parentIndex) + rowH*0.55,    // คุมเข้าหาพ่อ
  nodeX(parent) nodeY(parentIndex)
```
stroke = `nodeColor(commit)`, ความหนา `2px` เต็ม เฉพาะในบทบาทแรกของแต่ละ commit
ที่ต้องวาด (ตามเงื่อนไข lane/parent)

### 2.4 จุด (node circle)
- ปกติ: รัศมี `5` (เลือก: `6`), เติม `nodeColor`, ขอบ `var(--canvas)` หนา 2 (`stroke`)
- เมื่อเลือก (selected): รัศมี `6` + ring วงแหวนสี `var(--text)` (รัศมี 8, stroke 1.5)
- drop-target (ลาก commit ไปวาง): ring สี `var(--teal)`

### 2.5 แถวข้อมูล (HTML rows)
- `.graph-row` สูง 28px, `.graph-cell` (เนื้อที่ lane) กว้าง = `graphW`
- ภายใน: ref chips → subject (ellipsis ยาว), author (120px), date (75px)
- chip สีตาม lane ของ commit (เพิ่มล่าสุด), `HEAD` เป็นพื้นทึบ, `tag` สีส้ม, `origin/HEAD` ถูกกรองทิ้ง
- hover/selected: ใช้ pseudo-element `::before` พื้นเน้นทรง pill (radius 999px)

### 2.6 Virtual scrolling
- วาดเฉพาะช่วงที่เห็น: `visibleRange` จาก `scrollTop / rowH` (บัฟเฟอร์ ±15 แถว)
- spacer `<div>` บน/ล่าง ชดเชยความสูงที่ยังไม่วาด
- `--graph-w` ใช้เป็นตัวแปร CSS ในการเริ่มตำแหน่ง highlight/spacer

---

## 3. ข้อจำกัด/ปัญหาด้านภาพในปัจจุบัน

| # | ปัญหา | สาเหตุ |
|---|-------|--------|
| 1 | edge เป็นเส้นตรงสีทึบหนา 2px เต็ม ไม่มี gradient/ความหนาแบบ "สาย" | วาดเป็น `<path>` stroke เดียว |
| 2 | สี lane วนซ้ำ 8 สี เจอ commit หลาย lane → สีใกล้กัน/ซ้ำ | `lane % COLORS.length` |
| 3 | จุดกลมเล็ก (r=5) มองไม่ค่อยชัด เวลามีหลายคอลัมน์ | ขนาดจุดคงที่ |
| 4 | ไม่มี animation/transition ตอนโหลด/expand/เลือก | ไม่มี `transition` บน SVG |
| 5 | chip และ subject แออัดเมื่อมีหลาย ref | flex เดียวบรรทัดเดียว |
| 6 | highlight เป็นแค่พื้นหลัง pills ไม่มี "tape/track" สีตาม lane | วาดเฉพาะ `::before` |

---

## 4. ไอเดียปรับให้สวยขึ้น (เรียงตาม impact / ง่าย-ยาก)

### 🟢 ง่าย (แก้ใน CSS/ตัวเลข แทบไม่มีผลกับโค้ดหลัก)
1. **เพิ่ม radius/ขนาดจุด & ลดความหนา edge**
   - จุด r 5→6 (ปกติ), 6→7 (selected), edge 2px→1.5px, ใส่ `opacity` บางส่วนให้ edge
   - จุด: แก้ตัวเลขใน `GraphView.vue` (`r=6`, `r: 5`)
2. **เพิ่ม `transition` ให้ ring/จุด/พื้น highlight** (0.12–0.18s) ให้ลื่น
   - `modern-ui.css`: เพิ่ม `transition: r/opacity` หรือ transition บน `.graph-row::before` (มีอยู่แล้ว 0.12s)
3. **เติม gradient/glow เล็กน้อยที่จุดที่ถูกเลือก** (drop-shadow เท่าของ `--teal`/`--text`)
4. **ปัดโทนสีให้เกิดคอนทราสต์ระหว่าง lane ข้างกัน** — จัด `COLORS` เป็นลำดับที่สีข้างเคียงไม่ใกล้กัน (ทั้งที่ตอนนี้วนตาม `lane % 8` อยู่แล้ว แต่ถ้า lane เยอะอาจจับคู่ให้สลับโทน)

### 🟡 กลาง (ต้องแตะ `GraphView.vue` + CSS)
5. **ทำ edge เป็น "สาย" กิ้วมอง (tapered/track)**
   - แทน stroke เดียว → วาด layer ซ้อน: เส้นบางสีพื้น (เหมือน track) + เส้นสี lane ทับ ทำเป็น "rail"
   - หรือใช้ `stroke` 2 ชั้น (อันล่างหนากว่าสีจาง, อันบนบางกว่าสีจัด) ให้เส้นมี depth
6. **แสดงสถานะ merge/branch point ให้ชัด**
   - จุดที่เป็น merge commit (มี >1 parent) ใช้สัญลักษณ์พิเศษ (วงแหวนสองชั้น/เส้นติ่ง)
7. **chip สีคงที่รายสาขา (branch color map) แทนสีตาม lane**
   - map ชื่อ ref → สี ที่คงที่ตลอด (แม้ lane เปลี่ยน) — ตอนนี้สีตาม lane ซึ่ง commit เดียวกัน 2 branch จะสีเดียวกัน
   - แก้ใน `git.ts` (กำหนดสีที่ `assignLanes`) หรือใน renderer ทำให้สีขึ้นกับชื่อ branch แทน
8. **subject ทำ 2 บรรทัดเมื่อ ref เยอะ** (ย้อนดูก่อนหน้านี้) — เลือกใช้เฉพาะเมื่อแออัดจริง เพื่อไม่ให้ทุกแถวสูง

### 🔴 ยาก (สถาปัตยกรรม/ข้อมูล)
9. **Pixel-perfect SVG แบบ full-render** — เปลี่ยนจาก "SVG ทับบน HTML rows" เป็นวาดทั้งแถวใน SVG
   (ต้องจัดการ virtual scrolling + text wrapping เอง หนักมาก)
10. **Explicit branch (colored track) ที่ต่อเนื่องถึง merge** — ต้องเก็บข้อมูล first-parent chain
    ต่อเนื่อง และวาด track ต่อเนื่องหลายมูลค่า (จนถึง commit ไม่ใช่แค่ `parents` ในหน้าต่าง)

---

## 5. ข้อแนะนำที่ "คุ้มค่า" เริ่มทำ

ถ้าต้องการเห็นผลชัด / เสี่ยงต่ำ เริ่มจาก:
- **#1 + #3** (ขนาดจุด, ความหนา edge, glow, transition) → ความรู้สึกโปรเจกต์ดีขึ้นทันที
- **#5** (edge เป็น rail 2 ชั้น) → ดูเป็น "professional git graph" มากขึ้น
- **#6** (ไฮไลต์ merge commit) → เพิ่มข้อมูลเชิงความหมายโดยไม่มีผลกับ performance

ไอเดียใดต้องการให้ลอง ขอแค่บอกลำดับที่อยากได้ แล้วผมจะทำเป็นแผน/implement ให้ได้ครับ
