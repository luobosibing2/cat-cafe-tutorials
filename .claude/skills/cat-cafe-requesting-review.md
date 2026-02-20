---
name: cat-cade-requesting-review
description: 当用户请求别人 review 代码时触发，强制执行请求前的自检
---

# Core Principle

**请求 review 前，先自己检查一遍。**

不要把明显的 bug 交给 reviewer，这是浪费对方的时间。

"请 review" 不等于"帮我找 bug"，而是"我已经检查过了，请你帮我看看有没有漏掉的。"

---

## 检查流程

**BEFORE 请求 review:**

1. **CHECK**：是否已经自检过代码？
   - 自己是否运行过测试？
   - 是否检查过常见的错误（类型错误、边界条件等）？
   - 是否验证了功能按预期工作？

2. **CHECK**：是否提供了足够的上下文？
   - 这段代码是做什么的？
   - 要解决什么问题？
   - 有什么特殊的约束或注意事项？

3. **BLOCK**：禁止的请求
   - ❌ "帮我 review 这段代码"（只有代码，没有上下文）
   - ❌ "这段代码有没有问题？"（自己没检查过）
   - ❌ "写完了一个功能"（没有说明功能是什么）
   - ❌ 直接贴大段代码，没有说明

4. **PASS**：允许的请求
   - ✅ 说明代码的目的和背景
   - ✅ 提到自己已经检查过什么
   - ✅ 指出希望重点 review 的部分
   - ✅ 如果有已知的疑问或不确定的地方，明确说出

---

## Block 场景

### 场景 1：没有上下文

**User:**
> 请缅因猫 review

**❌ 错误的请求:**
> @缅因猫 帮我 review 这段代码
> ```javascript
> function calculateTotal(items) {
>   return items.reduce((sum, item) => sum + item.price, 0);
> }
> ```

**问题：** 缅因猫不知道这段代码是做什么的，review 的重点是什么。

---

### 场景 2：没自检过

**User:**
> 让 reviewer 看看

**❌ 错误的请求:**
> 这段代码有没有问题？帮我找找 bug。

**问题：** 自己没检查过，把找 bug 的工作推给 reviewer，浪费时间。

---

### 场景 3：没有明确重点

**User:**
> 请 review

**❌ 错误的请求:**
> 我写了一个模式系统，大概 500 行，帮我 review 一下。

**问题：** 500 行代码太多了，没有指明重点，reviewer 不知道从哪里开始。

---

## 通过场景

### 场景 1：提供上下文 + 自检

**User:**
> 请缅因猫 review

**✅ 正确的请求:**
> @缅因猫

**背景：**
我在实现辩论模式，需要一个系统来管理不同的辩论状态（idle, debating, voting, ended）。

**代码：**
```typescript
enum DebateState {
  IDLE = 'idle',
  DEBATING = 'debating',
  VOTING = 'voting',
  ENDED = 'ended'
}

class ModeHandler {
  private state: DebateState = DebateState.IDLE;

  startMode(participants: string[]) {
    if (this.state !== DebateState.IDLE) {
      throw new Error('Mode already active');
    }
    this.state = DebateState.DEBATING;
    // ...
  }
}
```

**我已经检查过：**
1. 状态转换逻辑（idle → debating → voting → ended）
2. 重复 startMode 的情况（会抛错）
3. 测试覆盖（已写 4 个测试用例）

**希望重点 review：**
1. 状态机的设计是否合理？
2. 是否有我没考虑到的边界情况？
3. 是否需要加状态持久化？

---

### 场景 2：修复后的 review 请求

**User:**
> 请求 review

**✅ 正确的请求:**
> @缅因猫

**背景：**
之前你指出我的 CAS 实现有竞态问题，我已经修复了。

**修复方案：**
```typescript
// 修复前
async function updateWithCAS(key: string, value: string) {
  const current = await redis.get(key);
  await redis.set(key, value, { NX: true });  // 没有检查版本
}

// 修复后
async function updateWithCAS(key: string, expected: string, value: string) {
  const result = await redis.watchAndMulti(key, expected, value);
  if (!result.success) {
    throw new Error('CAS failed: version mismatch');
  }
  return result;
}
```

**我已经验证：**
1. 单线程环境下能正常更新
2. 并发情况下，版本不匹配会抛错
3. 新增了 2 个并发测试用例

**请确认：**
1. 这个修复方案是否正确解决了竞态问题？
2. 是否有更好的实现方式？

---

### 场景 3：复杂功能的 review

**User:**
> 请帮忙看看

**✅ 正确的请求:**
> @缅因猫

**背景：**
我实现了一个完整的模式系统，支持：
1. 多只猫同时参与（@布偶猫 @暹罗猫）
2. 模式切换（辩论模式、投票模式等）
3. 流式消息路由（@mention 触发）
4. 模式状态持久化（存到 Redis）

**涉及的文件：**
- `modeSystem.ts` (200 行) - 核心逻辑
- `orchestrator.ts` (150 行) - 消息路由
- `modeStore.ts` (100 行) - 状态管理
- `router.ts` (80 行) - @mention 解析

**我已经检查过：**
1. 所有测试通过（729 tests）
2. 模式切换逻辑（idle ↔ active）
3. 并发情况（两只猫同时切换模式）
4. 边界情况（空 participants、无效 catId）

**希望重点 review：**
1. 架构设计是否合理？有没有过度设计？
2. 性能问题：每次消息都要解析 @mention，会不会慢？
3. 测试覆盖是否充分？

**已知疑问：**
1. 是否需要加模式切换的防抖？（防止快速切换）
2. 模式状态存在 Redis，如果 Redis 挂了怎么办？

---

## 自检清单

**在请求 review 前，自己先检查：**

- [ ] 代码能正常运行吗？
- [ ] 测试都通过了？
- [ ] 有没有明显的类型错误？
- [ ] 边界情况考虑了吗？（空输入、null、undefined）
- [ ] 是否有潜在的性能问题？
- [ ] 是否有安全问题？（SQL 注入、XSS、权限检查）
- [ ] 是否提供了足够的上下文？

---

## 核心精神

**请求 review 不是让别人帮你写代码，是让别人帮你找没看到的盲点。**

- 自己先检查 = 尊重 reviewer 的时间
- 提供上下文 = 让 reviewer 能有效 review
- 指明重点 = 提高 review 效率

**好的 review 请求 = 高效的协作。**

---

## 与 receiving-review 的区别

| Skill | 角色 | 场景 | 动作 |
|-------|------|------|------|
| `cat-cafe-requesting-review` | **请求者** | 写完代码，请求别人 review | 自己先检查 → 提供上下文 → 明确重点 |
| `cat-cafe-receiving-review` | **被 review 者** | 收到 review 反馈 | 理解问题 → 修复代码 → 验证解决 |
