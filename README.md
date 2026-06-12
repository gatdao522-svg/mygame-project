# STRIKE ARENA 🔫

Мультиплеерный 3D FPS-шутер в стиле Counter-Strike. Three.js + Node.js + Socket.IO.

## Запуск локально

```bash
npm install
npm start
# открой http://localhost:3000
```

## Деплой (Railway / любой Node-хостинг)

Просто задеплой репозиторий — сервер слушает `process.env.PORT` (по умолчанию 3000). Игроки заходят по одной ссылке и попадают на общий сервер.

## Фичи

- 🗺 Карта **de_arena** — продуманная трёхлайновая карта в стиле CS (mid с дверью, точки A и B, споты для снайпера, ящики для укрытий)
- 🔫 4 оружия: **AK-47** (авто, спрей с отдачей как в CS), **Glock** (полуавто), **AWP** (скоуп, ваншот), **нож**
- 💥 Отдача, разброс при движении, перезарядка, хедшоты (x3)
- 🧍 Анимированные 3D-персонажи двух команд (бег, прыжки, присед, стрельба, смерть)
- 🌐 Мультиплеер: командный дезматч T vs CT, киллфид, таблица счёта (Tab), чат (Enter), миникарта
- 🔊 Процедурный звук: выстрелы, перезарядка, хитмаркеры, шаги
- ⚡ Оптимизация: merged geometry, ограничение pixelRatio, интерполяция игроков

## Управление

| Клавиша | Действие |
|---|---|
| WASD | движение |
| Shift | тихий шаг |
| Ctrl / C | присед |
| Space | прыжок |
| ЛКМ | огонь |
| ПКМ | скоуп (AWP) |
| R | перезарядка |
| 1-4 | смена оружия |
| Tab | счёт |
| Enter | чат |

## Ассеты и лицензии

- Персонажи: [Quaternius — Toon Shooter Game Kit](https://quaternius.com) (CC0)
- AK-47: [Quaternius](https://poly.pizza/m/LeYp0kGyz7) (CC0)
- Glock: [J-Toastie](https://poly.pizza/m/q3lsX3tSta) (CC-BY) via poly.pizza
- AWP: [Kyler Swanson](https://poly.pizza/m/fKsTWWhSkqt) (CC-BY) via poly.pizza
- Combat Knife: [J-Toastie](https://poly.pizza/m/ufxlG9WDqn) (CC-BY) via poly.pizza
- Звуки и текстуры — процедурная генерация (WebAudio / Canvas)
- [three.js](https://threejs.org) r160 (MIT), [Socket.IO](https://socket.io) (MIT)
