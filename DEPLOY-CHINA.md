# 让 ArguMentor 在国内可访问（Cloudflare + 自有域名）

## 先读这一段（很重要）

- **你已经有 Cloudflare 账号了**，Worker 也部署成功了。注册不是问题。
- 国内打不开的是 **`argumentor.argumentor.workers.dev` 这个域名**——它被 DNS 污染。**换账号没用。**
- 唯一的解法：**给 Worker 绑一个你自己的域名**（比如 `api.你的域名.com`）。Cloudflare 的服务器在国内能连，只是 `workers.dev` 这个名字被封了。换个没被封的域名，就能访问。
- **诚实提醒：** Cloudflare 免费版的节点不在国内，所以从国内访问**可能偏慢、偶尔不稳**，但一般够做演示。如果你要**国内稳定高速**，那应该用腾讯云/阿里云的云函数（不是 Cloudflare）——需要的话我再给你另一份指南。

---

## 第一步 · 弄到一个域名

按你的**付款方式**二选一。

### 路线 A：有国际信用卡（最省事）

在 Cloudflare 里直接买，买完自动就在你账号里，不用改 DNS。

1. 登录 https://dash.cloudflare.com
2. 左侧 **Domain Registration → Register Domains**
3. 搜一个便宜域名（`.com` 约 $10/年；`.xyz`、`.top` 更便宜），加入购物车，用信用卡付款。
4. 买完它**自动**成为你 Cloudflare 账号里的一个“站点（zone）”。**跳到第三步。**

### 路线 B：只能用支付宝/微信（国内注册商）

在国内注册商买域名，再把它**托管**到 Cloudflare。

1. 到**腾讯云 DNSPod**（dnspod.cn）、**阿里云万网**（wanwang.aliyun.com）或**西部数码**买一个便宜域名。
   - 选 `.top` / `.xyz` / `.icu` 这类，首年常常只要 ¥10–39。用支付宝付款。
   - **不需要备案（ICP）**——我们只是把解析指向 Cloudflare，再用 Worker，不在国内服务器上放网页。
2. 买完先别管注册商自带的解析，下一步把它搬到 Cloudflare。

---

## 第二步 · 把域名托管到 Cloudflare（仅路线 B 需要）

1. 登录 https://dash.cloudflare.com → 右上 **Add a site / 添加站点** → 输入你刚买的域名 → 选 **Free / 免费** 套餐。
2. Cloudflare 会扫描并给你**两个 nameserver**（形如 `xxx.ns.cloudflare.com`、`yyy.ns.cloudflare.com`）。**复制它们。**
3. 回到你买域名的注册商后台，找到该域名的 **DNS 服务器 / 域名服务器（Nameservers）** 设置，把原来的两条**替换**成 Cloudflare 给的两条，保存。
   - 腾讯云：域名管理 → 该域名 → 管理 → “DNS 解析” 上方的“修改 DNS 服务器”。
   - 阿里云：域名控制台 → 该域名 → “DNS 修改”。
4. 回 Cloudflare 点 **Done / 完成**，然后等它变成 **Active / 已激活**（通常几分钟到几小时）。激活后再继续。

---

## 第三步 · 把域名绑到你的 Worker

> 如果你之前把 Worker 删了，先在 `worker` 文件夹里重新部署一次：
> ```bash
> cd '/Users/cts/Academic/0_Projects/2026_Persona-MAD/revised_paper_materials/argumentor-github/worker'
> npx wrangler deploy
> ```
> 密钥和访问码如果也删了，重新设一次：
> `npx wrangler secret put DEEPSEEK_API_KEY` 和 `npx wrangler secret put ACCESS_CODE`。

1. Cloudflare 控制台 → **Workers & Pages** → 点开你的 **argumentor** Worker。
2. **Settings → Domains & Routes → Add → Custom Domain**。
3. 填一个子域名，例如：**`api.你的域名.com`**（把“你的域名”换成你买的那个）。
4. 点 **Add Domain**。Cloudflare 会**自动**建好 DNS 记录和 HTTPS 证书，等一两分钟显示 **Active**。
5. 验证（在国内用浏览器直接打开）：
   ```
   https://api.你的域名.com/api/status
   ```
   看到一串 JSON，里面有 `"configured":true` 和 `"live":true`，就成了。

---

## 第四步 · 让网站指向这个新域名

在项目的 **源文件夹**（不是 argumentor-github 里的那份，是原始的“论证工坊”）操作：

```bash
cd '/Users/cts/Academic/0_Projects/2026_Persona-MAD/revised_paper_materials/argumentor-github'
node build-site.mjs --api https://api.你的域名.com
rm -rf docs && cp -R site/. docs/
git add docs && git commit -m "Point the site at the China-reachable Worker domain" && git push
```

> 这一步只把一个**网址**写进页面（`docs/config.mjs`），**不是密钥**——密钥一直在 Cloudflare 的加密存储里，不进仓库、不进网页。

等一两分钟 GitHub Pages 重新发布后，打开你的站点
`https://writinginstruction202610.github.io/argumentor/`，右上角徽标会从“离线模板模式”变成 **DeepSeek · deepseek-flash**，第一次运行反馈时会要你输入**访问码**（你用 `wrangler secret put ACCESS_CODE` 设的那个）。

---

## 第五步 · 确认 + 守住钱包

- 用**无痕窗口**在国内网络打开站点，像评委一样走一遍：载入示例 → 第 3 步填自评 → 勾选同意 → 运行。约 7 秒出四角色反馈，说明国内可用。
- `worker/wrangler.toml` 里的 **`ALLOWED_ORIGIN`** 要是你的站点地址 `https://writinginstruction202610.github.io`（之前设过就不用动）。
- **把每日上限调低**：`wrangler.toml` 里 `MAX_DAILY_CALLS` 和 `MAX_DAILY_TOKENS` 现在很高（接近不限），改成比如 `MAX_DAILY_CALLS = "200"`、`MAX_DAILY_TOKENS = "1000000"`，然后 `cd worker && npx wrangler deploy` 重新部署。
- **DeepSeek 账户余额保持小额**——这是真正的硬上限。前几天多看一眼用量页。
- 出事随时可停：`cd worker && npx wrangler delete`（删掉 Worker，立刻停止任何消费）。

---

## 还是不行 / 太慢怎么办

- **打不开 `api.你的域名.com`**：确认域名在 Cloudflare 已 **Active**，且 Worker 的 Custom Domain 已 **Active**；用 `https`，不要带结尾斜杠。
- **浏览器报 CORS**：`wrangler.toml` 的 `ALLOWED_ORIGIN` 必须**正好**等于站点来源 `https://writinginstruction202610.github.io`（没有路径、没有结尾斜杠），改完 `npx wrangler deploy`。
- **能开但很慢/时断时续**：这是 Cloudflare 免费节点不在国内的正常现象。要**国内稳定**，就改用**腾讯云/阿里云云函数**托管同一套 Worker 逻辑（密钥放在云函数的环境变量里，同样不进网页）——需要的话我给你写那份代码和指南。
- **还是搞不定**：别忘了你已经有一个**在国内完全可用**的方案——在线演示站（录制真实会话 + 浏览器内离线体验）+ 下载到本机用自己的密钥跑真实 AI。评委用这两样已经能完整理解和评估。
