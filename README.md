# Migraciones — проверка статуса дела

Сервис на **Node.js** и **Playwright** поднимает HTTP-сервер: по защищённому запросу открывает [Consulta Unificada](https://www.migraciones.gob.ar/accesible/consultaTramitePrecaria/ConsultaUnificada.php), вводит номер дела и дату рождения и забирает текст результата.

## Локальная проверка

1. Установите [Node.js](https://nodejs.org/) 20+.
2. Скопируйте `config.local.example.json` в `config.local.json` и заполните поля (файл в `.gitignore`).
3. В каталоге проекта:

```bash
npm install
npm run check
```

В консоль выведется JSON с полем `ok`, `lines` (распарсенные строки) и при ошибке — `error`.

Без `config.local.json` можно задать переменные окружения: `EXPEDIENTE`, `FECHA_NACIMIENTO`, при необходимости `CONSULTA_URL`.

## Пошагово: залить код на GitHub (первый раз)

Файл `config.local.json` с вашими данными **не попадает в Git** (он в `.gitignore`). В GitHub уедет только код; **секреты потом внесите в Railway Variables**.

1. Зайдите на [github.com/new](https://github.com/new).
2. **Repository name:** например `migraciones-consulta-bot`.
3. Выберите **Private** (рекомендуется) или Public.
4. **Снимите** галочки «Add a README» и «Add .gitignore» — репозиторий должен быть **пустым**.
5. Нажмите **Create repository**.
6. На странице подсказки выберите **…or push an existing repository** и выполните **на своём Mac** в терминале (папка проекта `TGB4`), подставив свой логин и имя репозитория:

```bash
cd "/Users/ivanklykov/Desktop/AI camp/TGB4"
git remote add origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

Если спросит логин и пароль: для GitHub нужен **Personal Access Token** вместо пароля (настройки GitHub → Developer settings → Tokens), либо используйте **GitHub Desktop** и выполните push через приложение.

После успешного `git push` код будет на GitHub.

## Что создать в Railway

1. [railway.app](https://railway.app) → войти (лучше через **GitHub**).
2. **New Project** → **Deploy from GitHub repo** → разрешите Railway доступ к репозиториям → выберите репозиторий с этим проектом (например `migraciones-consulta-bot`).
3. Дождитесь **сборки по Dockerfile** (в логах не должно быть ошибки; образ с Playwright тяжёлый — первая сборка может занять несколько минут).
4. Дальше по списку ниже: **Variables**, **Domain**, **Cron**.
5. Во вкладке **Variables** у сервиса добавьте (названия **точно** как в списке):

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `EXPEDIENTE` | да | Номер дела |
| `FECHA_NACIMIENTO` | да | Дата `DD/MM/YYYY` |
| `CRON_SECRET` | да | Длинная случайная строка; без неё `/run` вернёт 401 |
| `CONSULTA_URL` | нет | По умолчанию уже нужная ссылка на Consulta Unificada |
| `TELEGRAM_BOT_TOKEN` | нет | Для уведомлений |
| `TELEGRAM_CHAT_ID` | нет | Ваш chat id |
| `ONLY_NOTIFY_ON_CHANGE` | нет | `1` (по умолчанию) — писать в Telegram только при смене статуса; `0` — при каждом успешном запуске |

6. **Settings** → **Networking** → **Generate Domain**, чтобы был публичный URL (скопируйте его для шага ниже).
7. **Cron** — см. раздел **«Два запуска в день (Буэнос-Айрес) и Telegram»** ниже: два расписания и один URL `/run`.

После первого успешного деплоя откройте **Deployments → View logs**: должна быть строка `Listening on …`.

## Два запуска в день (Буэнос-Айрес) и Telegram

Часовой пояс **America/Argentina/Buenos_Aires** сейчас **UTC−3** (без перевода на летнее время). Планировщик **Railway Cron** задаёт время в **UTC**.

| Когда в Буэнос-Айресе | Расписание cron (UTC) |
|------------------------|------------------------|
| **10:00**              | `0 13 * * *`          |
| **17:00**              | `0 20 * * *`          |

Если правила часового пояса в Аргентине изменятся, **пересчитайте часы в UTC** в Railway.

### Telegram

1. В Telegram откройте **@BotFather** → команда `/newbot` → сохраните **токен**.
2. Узнайте **chat id** (например бот **@userinfobot** или свой способ). Боту нужно разрешить писать вам (например **Start** в диалоге с ботом).
3. В Railway → **Variables** добавьте:
   - `TELEGRAM_BOT_TOKEN` — токен от BotFather  
   - `TELEGRAM_CHAT_ID` — числовой id чата (или группы)

**Как часто слать сообщения**

- **Только при смене** статуса (и при первом успешном запуске после сброса состояния) — **не** добавляйте `ONLY_NOTIFY_ON_CHANGE` или оставьте не `0`.
- **После каждой проверки** (удобно для двух запусков в день) — добавьте **`ONLY_NOTIFY_ON_CHANGE=0`**.

Сообщение в Telegram содержит краткую строку статуса (дата и код последнего шага), как в поле `texto` ответа `/run`. При **ошибке** проверки (`"ok": false`) уведомление в Telegram **не** отправляется.

### Два Cron в Railway

Создайте **два отдельных** ресурса **Cron** в том же проекте (один Cron — одно расписание):

1. **Cron «утро BA»** — расписание: `0 13 * * *`  
2. **Cron «вечер BA»** — расписание: `0 20 * * *`  

В обоих укажите **HTTP GET** на один и тот же URL (подставьте свой домен и секрет):

```text
https://ВАШ-ДОМЕН.up.railway.app/run?secret=ВАШ_CRON_SECRET
```

Домен должен быть у **сервиса с этим приложением** (где в логах видно `Listening on …`).

### Проверка после настройки

1. Откройте в браузере URL `/run?secret=…` — в ответе `"ok": true`, поля `fecha`, `estado`, `texto`.
2. При настроенном Telegram и `ONLY_NOTIFY_ON_CHANGE=0` должно прийти сообщение от бота.
3. Для теста Cron можно временно поставить ближайшие минуту и час в UTC, убедиться в логах сервиса и в Telegram, затем вернуть `0 13` и `0 20`.

## Railway — быстрый тест

После деплоя вызовите проверку вручную (подставьте свой домен и секрет):

```text
https://ВАШ-ДОМЕН.railway.app/run?secret=ВАШ_CRON_SECRET
```

Ответ `200` и `"ok": true` означает успешный проход формы (или смотрите тело ответа в браузере / в логах). Полная сводка по Telegram и двум Cron — в разделе **«Два запуска в день (Буэнос-Айрес) и Telegram»** выше.

Файл состояния `data/last-fingerprint.txt` на Railway **сбрасывается** при новом деплое, если не подключён том (после деплоя возможен лишний «первый» Telegram при режиме только при смене).
