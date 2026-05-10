# RTL test bench · מבחן כיווניות

This file mixes English (LTR) and Hebrew (RTL) content to exercise per-block direction auto-detection. Each section is labeled so you can spot regressions.

---

## 1 · Pure English paragraph

The quick brown fox jumps over the lazy dog. Bullets, numbers, punctuation, and inline `code` should all behave normally.

## 2 · פסקה בעברית

השועל החום הזריז קופץ מעל הכלב העצלן. נקודות, מספרים, סימני פיסוק וקוד `inline` צריכים להתנהג נכון. הסימן בסוף המשפט אמור לנחות בצד השמאלי.

## 3 · Mixed inline · משפט מעורב

This sentence starts in English ואז עובר לעברית and back to English. The paragraph itself is detected as LTR (first strong char). Punctuation in the middle should follow Unicode bidi rules.

המשפט הזה מתחיל בעברית and switches to English ואז חוזר. The whole block is detected as RTL because the first strong char is Hebrew.

---

## 4 · Headings

# כותרת ראשית בעברית
## Heading 2 in English mixed with עברית
### תת-תת כותרת

---

## 5 · Bullet list — LTR title

- First English item
- Second English item with a longer line that should wrap normally
- Third item

## 6 · רשימה — כותרת בעברית

- פריט ראשון
- פריט שני עם משפט ארוך יותר כדי לוודא שגלילה ועיטוף עובדים
- פריט שלישי

## 7 · Mixed bullet list

- English bullet — marker on the left
- פריט בעברית — הסמן צריך להופיע בצד ימין
- Another English item — back to left
- שוב פריט בעברית

## 8 · Numbered list, mixed

1. First English step
2. צעד שני בעברית
3. Third step in English
4. צעד רביעי

---

## 9 · Task list

- [ ] LTR task that's still pending
- [x] LTR task done
- [ ] משימה בעברית, ממתינה
- [x] משימה בעברית שהושלמה — הצ'קבוקס בצד ימין

---

## 10 · Blockquotes

> A regular English blockquote. The colored bar should be on the LEFT.

> ציטוט בעברית. הפס הצבוע צריך להופיע בצד ימין של הבלוק.

> Mixed: English first ואחר כך עברית. The block is LTR (English starts), bar on the left.

---

## 11 · Callouts

> [!NOTE] 💡
> A note in English. The accent border should be on the left.

> [!TIP] ✅
> טיפ בעברית. הסרגל הצבעוני צריך להופיע בצד ימין.

> [!WARNING] ⚠️
> Mixed callout: starts in English אבל ממשיך בעברית. Detect as LTR.

> [!IMPORTANT] 📌
> *Inline emphasis* and **bold** should still work בתוך callout בעברית.

---

## 12 · Toggles

<details>
<summary>English toggle — triangle on the left</summary>

Content inside, in English. The disclosure caret on `summary` should sit at the inline-start (left here).

</details>

<details>
<summary>טוגל בעברית — המשולש בצד ימין</summary>

תוכן בעברית. סמן ה-▶ אמור להפוך ל-◀ ולשבת בצד ימין כשהטוגל פתוח.

</details>

---

## 13 · Tables

| Column A | Column B | Column C |
|---|---|---|
| English row | More English | Plain text |
| שורה בעברית | תא נוסף | טקסט רגיל |
| Mixed row | תא בעברית | last cell |

---

## 14 · Code blocks (must stay LTR)

```js
// Even inside an RTL document, code is always LTR.
function greet(name) {
  return `Shalom, ${name}!`;
}
```

```python
# Hebrew comment — but the code itself must stay LTR.
# שלום, זו הערה בעברית בתוך קוד פייתון.
def greet(name):
    return f"Shalom, {name}"
```

Inline `code with עברית inside` — the inline code mark inherits paragraph direction; that's fine.

---

## 15 · Links and images

- [Plain English link](https://example.com)
- [קישור בעברית](https://example.com)
- Mixed: see [the Hebrew docs · התיעוד](https://example.com) for more

---

## 16 · Long paragraphs (wrap test)

זו פסקה ארוכה שאמורה לבדוק שעיטוף שורות עובד נכון בכיוון מימין-לשמאל. כשהמשפט נמשך מעבר לרוחב הדף, השורות צריכות להישבר בצד ימין ולהמשיך משמאל לימין בכל שורה חדשה. זה גם בודק שאין יישור-לשמאל מוטעה שגורם לשורה האחרונה להופיע בצד שמאל.

This is a long English paragraph that should test line wrapping in LTR direction. The text should wrap from left to right and continue on subsequent lines starting from the left edge of the content area.

---

## 17 · Edge cases

- Bullet with leading number: 2024 was a great year. Marker should still be left.
- פריט שמתחיל במספר: שנת 2024 הייתה טובה. הסמן בצד ימין.
- Bullet with leading symbol: `→` then English. Symbol is bidi-neutral, item resolves to LTR.
- פריט עם סמל בהתחלה: `→` ואחר כך עברית.

---

## 18 · Frontmatter (LTR-only metadata)

```yaml
---
title: בדיקת RTL
author: Aviran
tags: [rtl, hebrew, bidi]
---
```

The frontmatter block should always render as plain LTR YAML in source view, regardless of value content.
