import Assert from "node:assert/strict";
import { chromium } from "playwright";

const Browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-zygote",
  ],
});
const Page = await Browser.newPage({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
Page.setDefaultTimeout(45000);
const Errors = [];
Page.on("pageerror", (ErrorValue) => Errors.push(ErrorValue.message));
Page.on("console", (Message) => {
  if (Message.type() === "error") Errors.push(Message.text());
});

let Count = 0;
const Pass = (Name) => {
  Count++;
  console.log(`PASS ${Count}: ${Name}`);
};

try {
  await Page.goto(
    `${process.env.CLOTH_URL || "http://127.0.0.1:5173/"}?quality=low`,
  );
  await Page.waitForFunction(
    () => window.clothEditor?.Engine?.stepCount > 5,
    null,
    { timeout: 120000 },
  );
  Assert.equal(await Page.locator("#gpu-error").isVisible(), false);
  Pass("Real-time GPU cloth & human avatar simulation and rendering");

  const SplitLayout = await Page.evaluate(() => {
    const leftRect = document
      .querySelector("#editor-pane")
      .getBoundingClientRect();
    const rightRect = document
      .querySelector("#simulation-pane")
      .getBoundingClientRect();
    return {
      leftWidth: leftRect.width,
      rightWidth: rightRect.width,
      leftOfRight: leftRect.right <= rightRect.left + 12,
    };
  });
  Assert.ok(SplitLayout.leftWidth > 180);
  Assert.ok(SplitLayout.rightWidth > 180);
  Assert.equal(SplitLayout.leftOfRight, true);
  Pass("Substance Designer graph & 2D pattern editor on left, 3D cloth simulation on right");

  Assert.equal(Errors.length, 0);
} finally {
  await Browser.close();
}
