import socket
import subprocess
import time
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from archsync.config import RulesConfig
from archsync.pipeline import run_build


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.mark.e2e
def test_dashboard_click_and_screenshot(tmp_path) -> None:
    fixture = Path(__file__).parents[1] / "fixtures" / "sample_repo"
    output = tmp_path / "out"
    state_db = tmp_path / "state.db"
    rules = RulesConfig.default()

    run_build(repo_root=fixture, rules=rules, output_dir=output, state_db=state_db, commit_id="e2e")
    assert (output / "index.html").exists()

    port = _free_port()
    server = subprocess.Popen(
        ["python3", "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=output,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        time.sleep(1.2)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1600, "height": 1100})
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
            page.wait_for_selector("#view-l1 svg .module-node")
            page.click("#view-l1 svg .module-node")
            screenshot = tmp_path / "dashboard.png"
            page.screenshot(path=str(screenshot), full_page=True)
            browser.close()

        assert screenshot.exists()
        assert screenshot.stat().st_size > 0
    finally:
        server.terminate()
        server.wait(timeout=5)
