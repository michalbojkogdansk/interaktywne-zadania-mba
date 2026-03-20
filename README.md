# 🧊 Korelacja Danych — MBA

> **Interaktywny test intuicji** | Zadanie przed zajęciami | ~15 minut

**Link dla studentów:** https://michalbojkogdansk.github.io/korelacja-danych-mba

**Wyniki (Issues):** https://github.com/michalbojkogdansk/korelacja-danych-mba/issues

---

## Jak to działa

Student wchodzi na stronę → podaje ksywę → odpowiada na 5 pytań o korelacje biznesowe → opcjonalnie opisuje swój "Data Audit" → odpowiedzi trafiają automatycznie do **GitHub Issues** z etykietą `student-response`.

---

## ⚙️ Konfiguracja (wymagana przed zajęciami)

Aby odpowiedzi studentów były automatycznie zapisywane w Issues, potrzebny jest **GitHub Personal Access Token** (fine-grained PAT) z uprawnieniem **Issues: Write** tylko na to repozytorium.

### Krok 1 — Utwórz token

1. Idź na: https://github.com/settings/tokens?type=beta
2. Kliknij **"Generate new token"**
3. Ustaw nazwę: `MBA Quiz Token`
4. W sekcji **Repository access** wybierz: *Only select repositories* → `korelacja-danych-mba`
5. W sekcji **Permissions** → **Issues** → ustaw na **Read and write**
6. Kliknij **"Generate token"** i skopiuj token (widoczny tylko raz!)

### Krok 2 — Wklej token do index.html

Otwórz plik `index.html` (edycja bezpośrednio na GitHub lub lokalnie), znajdź linię:

```javascript
const GITHUB_TOKEN  = 'YOUR_GITHUB_TOKEN_HERE';
```

I zamień `YOUR_GITHUB_TOKEN_HERE` na swój token.

### Krok 3 — Zapisz i gotowe

Commitujesz zmianę — strona automatycznie się zaktualizuje (GitHub Pages).

---

## 📋 Pytania w quizie

| # | Para wskaźników | Prawdziwa korelacja |
|---|---|---|
| 1 | Opóźnienia logistyczne ↔ Retencja SaaS | Silna negatywna |
| 2 | Ton na Slacku ↔ Liczba bugów | Pozytywna |
| 3 | Czas reakcji na reklamację ↔ LTV | Silna pozytywna |
| 4 | Liczba dashboardów BI ↔ Jakość decyzji | Niemal zerowa |
| 5 | Real-time ERP ↔ Win rate sprzedaży | Pozytywna (~23%) |

---

## 🎨 Design

Paleta kolorów: **Winter Chill** (#B8E3E9 / #93B1B5 / #4F7C82 / #0B2E33)

---

*Repo wygenerowane przez Tasklet · MBA · Korelacja Danych 2026*
