# Business Intelligence Analytics Admin — Features
## You can create a chart or pivot table faster than it takes to type it into AI

## Overview

Analytics Admin is a multi-user business intelligence platform that allows organizations to connect to their databases, model data views, and build interactive dashboards. Each user operates within an isolated workspace, with dedicated connectors, views, and dashboards.

---

## Dashboards

- Tabular display of data sourced from a view
- Automatic removal of NULL values from displayed results
- Conditional formatting of numeric values: positive values shown in green, negative values shown in red
- Support for numeric and date/time formatting
- Configurable row limits
- Wide tables stay easy to read: the table scrolls inside a window-high box with a sticky header row, the first column is frozen, the row under the mouse is highlighted, and a navigation strip above the table (column arrows, a top scrollbar and the visible column range) or the arrow keys move sideways by whole columns without leaving the current row
- Automatic detection of data types to generate appropriate filtering conditions for a view
- A text column can have several conditions (equals, contains, does not contain); positive conditions of one column are joined with OR, "does not contain" with AND, and all of them are saved with the dashboard and restored when it is opened again
- Clicking a table cell copies its displayed value to the clipboard (a short confirmation appears next to the cell); it does not change the filters
- Column order defined in the dashboard settings (**Columns** list, up/down arrows or drag and drop) is applied to the table and saved with the dashboard
- The **View/Table** picker refreshes automatically whenever a view is saved, deleted or shared, without reloading the page

### Pivot Tables

- Creation of pivot (cross-tabulated) tables
- Column hiding and reordering; pivot dimensions keep the order defined under **Dimensions**, while measures and other columns follow the order of the **Columns** list
- Configuration of pivot dimensions and aggregation functions: Sum, Count, Average, Maximum, and Minimum
- Display of columns that are neither assigned as dimensions nor as metrics

### Charts

- Chart creation from a library of 17 predefined chart types
- Configuration of X and Y axes, with support for additional series
- Each series can be independently defined as a column (bar) or a line
- Further breakdown of a series by an additional dimension, based on a selected column
- Ability to show or hide individual values in the chart legend
- Toggle for displaying or hiding gridlines
- Configuration of chart dimensions and layout, including the number of charts displayed per row
- KPI cards with compare columns
- KPI aggregation **Last value (first table row)**: takes the value shown in the top row of the table, respecting the current sorting (including multi-column sorting) and grouping; compared with the same column it uses the second row (e.g. this month against last month)
- Charts are aggregated in the database over all filtered rows, not only the rows loaded into the table
- Chart description (ⓘ in the chart header): a rich-text note (bold, italic, underline, lists, links, highlight and column references that follow column renames), optionally shown as a subtitle under the chart title and included in the PDF export
- **Where the data comes from** is filled in automatically for every chart: view, axes, split, each series with its aggregation, the formula of custom view columns, dashboard filters and view conditions, with a link to open the view in View modeling
- Descriptions are sanitized on the server (allowlist of tags and attributes), so they cannot carry scripts or foreign markup
- The enlarged chart is remembered per dashboard; deleting a chart or KPI card asks for confirmation
 
---

## View Modeling

The view modeling layer allows users to define reusable data structures on top of source tables and views.

- Modeling based on tables and views, with support for subviews
- Saved views are stored in the application's internal database, next to users, connectors and dashboards, for every database engine (SQL Server, MySQL, MariaDB, PostgreSQL, SQLite). Dashboards read the saved SQL from there; nothing is created in the source database, so a read-only database user is enough, and reports keep working (and can still be shared) after the source database moves to another server
- On Helios databases (the table `dbo.TabObecnyPrehled` exists) each view is also written to `TabObecnyPrehled`, so it can be browsed in Helios: `NazevSys` = `hvw_<name>`, `Nazev` = the view description (or `hvw_<name>` when empty), `DefView` = the definition without ORDER BY, the column definition `DefAttrs`, `Autor`, `DatPorizeni` and `Cislo` (next free number below 10000). The row is updated when the view changes and deleted with it; rows that belong to someone else are never overwritten (saving under such a name is refused)
- If the database user cannot write to `TabObecnyPrehled`, the view is still saved in the application and dashboards work; the user sees a warning
- Views saved by earlier versions into Helios `TabObecnyPrehled` are imported automatically the first time a connector is used. If the database user cannot read the table, the import is retried after the next restart
- Reopening a saved view restores exactly the modeled column selection, joins, conditions and custom columns
- Selection of the source connector for each view
- One-click exposure of a view as an API endpoint
- API access supports GET requests in both tabular and tree (hierarchical) structures, as well as PUT requests
- **Filtered GET/POST**: send a JSON body with one or more `column: value` pairs to receive only matching rows; if no body is sent, the full view result is returned as before
- Downloadable sample `.bat` script demonstrating API usage
- Renaming of tables and columns to custom aliases directly by clicking on the column header
- Color-coded visual indication when a subview is added to the model
- Column selection for inclusion in a view via checkboxes
- Visual display of join conditions between tables
- Support for adding custom columns and custom conditions, with built-in protection against SQL injection
- Enhanced graphical interface for building WHERE conditions
- Support for ORDER BY and GROUP BY clauses
- Automatic SQL query generation with syntax highlighting
- Live data preview

### View Sharing

Views can be shared with other users and connectors, including connectors pointing to a different database.

- Only the author of a view (the owner of the connector it was saved through) can share it
- Sharing uses the recipient connector's **share code**: the recipient copies it from the connector details and sends it to the author; the author verifies who the code belongs to before sending the invitation
- The recipient sees pending invitations in **View modeling** (with a badge in the menu), previews the view (tables, columns and SQL) and accepts or declines it
- **Same database**: the recipient gets access to the author's view; no copy is created. The database is recognised from the connector settings (engine, server, port and database name)
- **Different database**: the view is rebuilt and test-run in the recipient's database first; missing tables, columns or permissions are reported and nothing is written. On success a read-only copy is stored for the recipient's connector
- Shared views are read-only for recipients: they cannot be edited, deleted, overwritten by saving under the same name, or shared further
- When the author saves a new version, recipients in the same database see it immediately; recipients with a copy are offered the update and can accept it or keep the current version
- The author sees the status of every share (waiting, accepted, error) and can revoke it; recipients can remove a shared view from their list. In both cases the view is only hidden, copies are kept
- Shared views appear in the recipient's dashboards and can be exposed through the recipient's own public API (read-only, see Security)

---

## Database Connectors

- Supported database engines: Microsoft SQL Server, MySQL, MariaDB, PostgreSQL, and SQLite
- Allowed IP addresses configurable independently for each connector's API access
- API authentication via bearer key, with a configurable custom header name
- API tenant identifier for connector-level access control
- Configurable maximum request rate (requests per minute)
- **Only views from Analytics admin**: when checked, dashboards offer only the views saved in Analytics Admin; otherwise the tables and views of the database are offered as well
- Unique share code (UUID) per connector for receiving shared views, with copy-to-clipboard and regeneration; a new code invalidates the old one while shares already accepted remain

---

## Security

- Transport security via SSL, supporting both PEM and PFX certificate formats
- Globally configurable trusted hosts (allowed IP addresses)
- CORS, Content Security Policy (CSP), and HSTS enforcement
- Request and access logging
- JWT secret used for verification of web tokens
- API bearer key and tenant identifier configured individually for each user and each connector
- Trusted host IP addresses configurable independently for each connector
- Configurable maximum request rate (requests per minute)
- Registration and authentication via email, with session validity limited by a defined time period
- Prevention of duplicate concurrent sessions
- Automatic IP blocking on the public API: an invalid API key blocks the client IP immediately, and repeated `400 Bad Request`, `403` or `404` responses within a short time window lead to a persistent block (threshold set by `API_BLOCKLIST_403_404_THRESHOLD`)
- Shared views are served through the recipient connector's own API tenant and key; keys are never shared between connectors, and writing (PUT) through a shared view is reserved for its author

---

## Multi-User Architecture

- Multi-user environment with separated connectors, views, and dashboards per user
- Controlled sharing of views between users and connectors (see View Sharing)
- Account registration and authentication handled exclusively through email
- Multi-language interface: Czech, English, German and French

---

## User Interface

- Sidebar with icon navigation (Dashboards, View modeling, Connectors) and item counts for each list
- Search field that filters dashboards, views and connectors while typing
- Language, background theme and account menu grouped at the bottom of the sidebar
- Resizable sidebar: drag its right edge (or use the arrow keys); the width is remembered per browser and a double-click restores the default
- Row actions (Edit, Share, View) appear on hover so item names use the full width
- Responsive layout for desktops, tablets and phones:
  - on wide screens the sidebar can be collapsed to an icon rail (remembered per browser), giving dashboards more room
  - below 1024 px the sidebar becomes a drawer opened from a top bar, and the dashboard settings panel opens as a sheet over the page; both close with the backdrop or Escape
  - charts per row is a maximum: narrower screens show fewer charts per row, down to one on phones; KPI cards, toolbars and forms rearrange as well
  - wide tables keep their horizontal scrolling with the column navigation
  - View modeling blocks stack on narrower screens; connector settings are grouped into Database connection and Public API
- Clicking a row in the list of views or connectors opens it, like a dashboard row
- Dark background theme support for all sidebar and sharing dialogs

---

## Requirements and Installation

The application is started with the following command:

```
pip install BI-analytics-admin
python -m src.web.server
```

Database changes are applied automatically on startup. The metadata database gets the `view_shares` table and a `share_uuid` column on `connectors` (existing connectors receive a code automatically), the `saved_views` and `saved_view_imports` tables (saved view definitions), the `expanded_chart` column on `dashboards` and the `description`, `show_caption`, `description_updated_by` and `description_updated_at` columns on `dashboard_charts`, so the database user needs permission to create and alter tables.

Chart.js and jsPDF are served from `src/web/static/vendor` (see the README there); no external CDN is needed.

### Dependencies

**Core**
- python-dotenv >= 1.0.0

**Data Science**
- numpy >= 1.24.0
- pandas >= 2.0.0
- scipy >= 1.10.0
- scikit-learn >= 1.3.0
- matplotlib >= 3.7.0
- seaborn >= 0.12.0
- jupyter >= 1.0.0
- notebook >= 6.5.0

**Web**
- fastapi >= 0.95.0
- uvicorn >= 0.21.0
- jinja2 >= 3.1.0
- requests >= 2.28.0

**Database**
- pyodbc >= 4.0.0 (MSSQL / SQL Server)
- sqlalchemy >= 2.0.0
- pymssql >= 2.2.0
- pymysql >= 1.0.2 (MySQL / MariaDB connector)
- psycopg2-binary >= 2.9.0 (PostgreSQL connector)
- sqlite3 (SQLite) is included in the Python standard library and requires no separate package

**Office / Export**
- openpyxl >= 3.1.0

**Utilities**
- python-dateutil >= 2.8.0
- tqdm >= 4.65.0
- cryptography >= 41.0.0 (PFX/PKCS12 extraction for HTTPS)

---

## Screenshots

![Dashboard view](img/screen1.jpg)

![Dashboard chart configuration](img/screen2.jpg)

![View modeling canvas](img/screen3.jpg)

![Query conditions and generated SQL](img/screen4.jpg)

![Connector management](img/screen5.jpg)

![Charts and table themes](img/screen6.jpg)

![Sharing a view: recipient check and share status](img/screen7.jpg)

![Incoming shared view: preview before accepting](img/screen8.jpg)

![Sales dashboard: KPI cards, bar + line combination, stacked bar, doughnut and multi-line chart](img/screen9.jpg)

![Chart types: grouped bar, 100 % stacked bar, horizontal bar, stacked area, pie and funnel](img/screen10.jpg)

![Chart settings: one series rendered as bars, another as a line](img/screen11.jpg)

![Chart description with the automatic "Where the data comes from" section](img/screen12.jpg)

![Desktop: the sidebar collapsed to an icon rail leaves more room for the dashboard](img/screen13.jpg)

![Phone: dashboard, sidebar as a drawer, dashboard settings as a sheet and a wide table with column navigation](img/screen14.jpg)

![Tablet: dashboard with two charts per row and View modeling with stacked blocks](img/screen15.jpg)


---
