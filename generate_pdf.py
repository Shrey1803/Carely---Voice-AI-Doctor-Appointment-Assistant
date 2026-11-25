"""
Converts project-plan.md into an HTML document with CSS,
then uses Headless Chrome to render it into a PDF.
"""

import re
import subprocess
from pathlib import Path
import markdown

SOURCE_MD = Path(r"C:\Users\hp\.gemini\antigravity\brain\ead17800-ba43-4340-9e9b-eb7489afcf79\project-plan.md")
HTML_OUT = Path(r"C:\Users\hp\Downloads\Internship Assignment\project-plan.html")
PDF_OUT = Path(r"C:\Users\hp\Downloads\Internship Assignment\Voice_AI_Doctor_Assistant_Project_Plan.pdf")
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def process_markdown_alerts(text: str) -> str:
    """Transform GitHub-style callouts into styled HTML containers."""
    def replace_alert(match):
        alert_type = match.group(1).upper()
        content = match.group(2).strip()
        icon = "💡"
        color_class = "alert-info"
        title = "NOTE"

        if alert_type == "IMPORTANT":
            icon = "⚡"
            color_class = "alert-important"
            title = "IMPORTANT REQUIREMENT"
        elif alert_type == "TIP":
            icon = "💡"
            color_class = "alert-tip"
            title = "PRO TIP"
        elif alert_type == "CAUTION":
            icon = "⚠️"
            color_class = "alert-caution"
            title = "CAUTION & PITFALLS"
        elif alert_type == "WARNING":
            icon = "🚨"
            color_class = "alert-warning"
            title = "WARNING"

        return f"""
<div class="alert-box {color_class}">
    <div class="alert-header"><span>{icon}</span> <strong>{title}</strong></div>
    <div class="alert-body">{content}</div>
</div>
"""
    # Match patterns like > [!IMPORTANT]\n> text...
    pattern = r">\s*\[!(IMPORTANT|TIP|CAUTION|WARNING|NOTE)\]\s*\n((?:>.*(?:\n|$))*)"
    
    def repl(m):
        atype = m.group(1)
        raw_body = m.group(2)
        lines = [re.sub(r"^>\s?", "", l) for l in raw_body.splitlines()]
        body_text = "\n".join(lines).strip()
        return replace_alert(re.match(r"(.*)", f"{atype}@@@{body_text}").expand(r"<!>\1<!>"))

    # Simpler regex replacement line by line
    processed_lines = []
    in_alert = False
    current_alert_type = ""
    alert_lines = []

    for line in text.splitlines():
        alert_match = re.match(r"^>\s*\[!(IMPORTANT|TIP|CAUTION|WARNING|NOTE)\]\s*$", line.strip())
        if alert_match:
            if in_alert:
                processed_lines.append(render_alert_box(current_alert_type, alert_lines))
                alert_lines = []
            in_alert = True
            current_alert_type = alert_match.group(1)
            continue

        if in_alert:
            if line.startswith(">"):
                alert_lines.append(re.sub(r"^>\s?", "", line))
            else:
                processed_lines.append(render_alert_box(current_alert_type, alert_lines))
                in_alert = False
                current_alert_type = ""
                alert_lines = []
                processed_lines.append(line)
        else:
            processed_lines.append(line)

    if in_alert:
        processed_lines.append(render_alert_box(current_alert_type, alert_lines))

    return "\n".join(processed_lines)


def render_alert_box(alert_type: str, lines: list) -> str:
    content = "<br>".join(lines)
    alert_type = alert_type.upper()
    icons = {
        "IMPORTANT": ("⚡", "alert-important", "IMPORTANT"),
        "TIP": ("💡", "alert-tip", "PRO-TIP"),
        "CAUTION": ("⚠️", "alert-caution", "CRITICAL CAUTION"),
        "WARNING": ("🚨", "alert-warning", "WARNING"),
        "NOTE": ("ℹ️", "alert-note", "NOTE"),
    }
    icon, css_class, title = icons.get(alert_type, ("ℹ️", "alert-note", "NOTE"))
    return f"""
<div class="alert-box {css_class}">
    <div class="alert-header"><span class="alert-icon">{icon}</span> <strong>{title}</strong></div>
    <div class="alert-body">{content}</div>
</div>
"""


def build_full_html(body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Carely — Voice AI Doctor Appointment Assistant — Complete Build Plan</title>
<style>
    @page {{
        size: A4;
        margin: 18mm 16mm 18mm 16mm;
        @bottom-right {{
            content: counter(page);
        }}
    }}

    * {{
        box-sizing: border-box;
    }}

    body {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 10.5pt;
        line-height: 1.55;
        color: #1e293b;
        background: #ffffff;
        margin: 0;
        padding: 0;
    }}

    h1, h2, h3, h4 {{
        color: #0f172a;
        font-weight: 700;
        page-break-after: avoid;
    }}

    h1 {{
        font-size: 20pt;
        line-height: 1.25;
        border-bottom: 2px solid #4f46e5;
        padding-bottom: 8px;
        margin-top: 0;
        margin-bottom: 14px;
        color: #312e81;
    }}

    h2 {{
        font-size: 13.5pt;
        margin-top: 22px;
        margin-bottom: 10px;
        padding-bottom: 4px;
        border-bottom: 1px solid #e2e8f0;
        color: #1e1b4b;
    }}

    h3 {{
        font-size: 11.5pt;
        margin-top: 14px;
        margin-bottom: 6px;
        color: #334155;
    }}

    p {{
        margin-top: 0;
        margin-bottom: 8px;
    }}

    hr {{
        border: 0;
        border-top: 1px solid #e2e8f0;
        margin: 16px 0;
    }}

    /* Blockquotes / Callout Header */
    blockquote {{
        border-left: 4px solid #6366f1;
        background-color: #f8fafc;
        padding: 8px 14px;
        margin: 10px 0;
        color: #475569;
        font-size: 10pt;
        border-radius: 0 6px 6px 0;
    }}

    blockquote strong {{
        color: #1e293b;
    }}

    /* Tables */
    table {{
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0 16px 0;
        font-size: 9.5pt;
        page-break-inside: avoid;
    }}

    th, td {{
        border: 1px solid #cbd5e1;
        padding: 7px 10px;
        text-align: left;
        vertical-align: top;
    }}

    th {{
        background-color: #f1f5f9;
        color: #0f172a;
        font-weight: 600;
    }}

    tr:nth-child(even) {{
        background-color: #f8fafc;
    }}

    /* Code & Prompts */
    pre {{
        background-color: #0f172a;
        color: #f8fafc;
        padding: 12px 14px;
        border-radius: 6px;
        overflow-x: auto;
        font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
        font-size: 8.5pt;
        line-height: 1.45;
        margin: 10px 0 14px 0;
        page-break-inside: avoid;
        border: 1px solid #1e293b;
        white-space: pre-wrap;
        word-break: break-word;
    }}

    code {{
        font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
        font-size: 9pt;
        background-color: #f1f5f9;
        color: #4338ca;
        padding: 2px 5px;
        border-radius: 4px;
    }}

    pre code {{
        background-color: transparent;
        color: inherit;
        padding: 0;
        border-radius: 0;
    }}

    /* Alerts */
    .alert-box {{
        margin: 12px 0;
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 9.5pt;
        page-break-inside: avoid;
    }}

    .alert-header {{
        font-weight: 700;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
    }}

    .alert-important {{
        background-color: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #1e40af;
    }}

    .alert-tip {{
        background-color: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #065f46;
    }}

    .alert-caution {{
        background-color: #fff1f2;
        border: 1px solid #fecdd3;
        color: #9f1239;
    }}

    .alert-warning {{
        background-color: #fffbeb;
        border: 1px solid #fde68a;
        color: #92400e;
    }}

    /* Lists */
    ul, ol {{
        margin-top: 0;
        margin-bottom: 10px;
        padding-left: 20px;
    }}

    li {{
        margin-bottom: 4px;
    }}

    /* Badges & highlights */
    .badge {{
        display: inline-block;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 8pt;
        font-weight: 600;
    }}

    /* Header document banner */
    .doc-banner {{
        background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
        color: #ffffff;
        padding: 16px 20px;
        border-radius: 8px;
        margin-bottom: 20px;
    }}

    .doc-banner h1 {{
        color: #ffffff;
        border-bottom: none;
        margin: 0 0 6px 0;
        padding: 0;
        font-size: 18pt;
    }}

    .doc-banner p {{
        margin: 0;
        font-size: 10pt;
        opacity: 0.9;
    }}

    /* Avoid page break before major section headers */
    .phase-section {{
        page-break-inside: avoid;
        margin-top: 18px;
    }}
</style>
</head>
<body>

<div class="doc-banner">
    <h1>🏥 Carely — Voice AI Doctor Appointment Assistant</h1>
    <p><strong>Complete Phase-Wise Engineering Breakdown & Copy-Paste AI Prompts</strong></p>
    <p style="margin-top: 4px; font-size: 9pt; opacity: 0.8;">SDE Intern Round 1 Assignment · Deadline: Wednesday, 25 November, 11:00 PM IST</p>
</div>

{body_html}

<div style="margin-top: 30px; padding-top: 10px; border-top: 1px solid #cbd5e1; text-align: center; font-size: 8.5pt; color: #64748b;">
    Carely Project Plan · Generated on {Path(r"C:\Users\hp").name}'s System · Confidential Assignment Submission
</div>

</body>
</html>
"""


def main():
    print(f"📖 Reading source Markdown from: {SOURCE_MD}")
    md_content = SOURCE_MD.read_text(encoding="utf-8")

    # Replace mermaid block with a clean diagram representation
    mermaid_cleaned = re.sub(
        r"```mermaid[\s\S]*?```",
        """
<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 9pt; margin: 10px 0;">
<strong>Pipeline Flow Diagram:</strong><br>
Browser Mic ➔ WebSocket ➔ Silero VAD ➔ ElevenLabs STT ➔ Google Gemini LLM (Function Calling) ➔ ElevenLabs TTS ➔ WebSocket ➔ Browser Speaker<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↳ SQLite Database (Doctors, Slots, Appointments)
</div>
""",
        md_content,
    )

    print("⚙️ Processing alerts and callouts...")
    processed_md = process_markdown_alerts(mermaid_cleaned)

    print("📄 Converting Markdown to HTML...")
    body_html = markdown.markdown(
        processed_md,
        extensions=["tables", "fenced_code", "nl2br", "sane_lists"],
    )

    full_html = build_full_html(body_html)
    HTML_OUT.write_text(full_html, encoding="utf-8")
    print(f"✅ HTML written to: {HTML_OUT}")

    print("🖨️ Invoking Headless Chrome to render PDF...")
    cmd = [
        CHROME_PATH,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={PDF_OUT}",
        str(HTML_OUT),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"🎉 PDF generated successfully at:\n{PDF_OUT}")
        print(f"File size: {PDF_OUT.stat().st_size / 1024:.1f} KB")
    else:
        print(f"❌ Chrome failed with code {res.returncode}: {res.stderr}")


if __name__ == "__main__":
    main()
