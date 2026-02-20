---
name: cat-cafe-receiving-review
description: 当用户提到收到 reviewer 反馈时触发，规范被 review 者的代码修复流程
---

# Core Principle

**收到 review 反馈后，作为被 review 者，必须用技术行动证明你理解了问题，而不是空洞的感谢。**

你是在**修复代码**，不是在 review 别人的代码。reviewer 已经指出了问题，你的任务是：
1. 理解 reviewer 的问题
2. 修复代码
3. 用测试证明问题解决（Red-Green 验证）

AI 天然倾向于讨好用户，会说 "You're absolutely right!" 但实际上可能不理解问题。这个 Skill 强制要求：
- 用行动（修复代码）代替言语（感谢）
- 用 Red-Green 验证证明问题真正解决
- 不理解时主动提问，不要假装理解

---

## 检查流程

**BEFORE 回应 review 反馈:**

1. **CHECK**：理解 reviewer 提出的问题了吗？
   - 能复述技术问题的本质？
   - 知道代码哪里有问题吗？
   - 理解 reviewer 的担忧吗？

2. **CHECK**：如果理解了问题
   - ✅ 直接开始修复代码
   - ✅ 写验证测试（Red-Green）
   - ✅ 运行测试证明问题解决

3. **CHECK**：如果不理解问题
   - ✅ 复述你的理解
   - ✅ 提出澄清问题
   - ✅ 不要说"收到"或"好的"就结束了

4. **BLOCK**：禁止的回应
   - ❌ "You're absolutely right!"
   - ❌ "Great point!"
   - ❌ "Excellent feedback!"
   - ❌ "Thanks for catching that!"
   - ❌ "让我现在就改"（在理解问题之前）
   - ❌ "收到"（没有后续技术讨论）
   - ❌ "好的，我马上去 review 这个问题"（你被 review，不是去 review 别人）

5. **PASS**：允许的回应
   - ✅ 直接修复代码 + 测试验证
   - ✅ "这个问题是 X 导致的，原因是 Y，修复方案是 Z"
   - ✅ "我理解你的担忧是...，需要澄清的是..."

---

## Block 场景

### 场景 1：表演性同意

**User:**
> 缅因猫 reviewer 说你这里用了 `==` 而不是 `===`，会导致类型转换问题

**❌ 错误的 AI 回应（被 review 者）:**
> You're absolutely right! Great catch! Thanks for pointing that out. Let me fix it now.

**问题：** 没有证明理解了问题，只是热情地回应，然后可能修复错误。

---

### 场景 2：假装理解

**User:**
> reviewer 说你的 CAS 实现有竞态条件问题

**❌ 错误的 AI 回应（被 review 者）:**
> 收到，我马上修。

**问题：** 没有复述对竞态条件的理解，可能修错。

---

### 场景 3：角色错乱 - 以为自己是 reviewer

**User:**
> reviewer 说你的 `VERDICT` 解析 fail-open

**❌ 错误的 AI 回应（误以为是 reviewer）:**
> 好的，我来 review 这段代码，看看是不是真的 fail-open...

**问题：** 你是被 review 者，reviewer 已经发现了问题，你应该去修复代码，而不是再 review 一次。

---

## 通过场景

### 场景 1：直接修复 + 技术复述

**User:**
> 缅因猫 reviewer 说你这里用了 `==` 而不是 `===`，会导致类型转换问题

**✅ 正确的 AI 回应（被 review 者）:**
> 这个问题是因为 JavaScript 的 `==` 会进行隐式类型转换，比如 `0 == ''` 返回 true。
>
> 我改成严格相等比较 `===`，确保类型和值都相等才返回 true。
>
> ```javascript
> - if (response.status == 200)
> + if (response.status === 200)
> ```
>
> 验证测试：
> ```javascript
> test('应该拒绝隐式类型转换', () => {
>   expect(validateStatus('200')).toBe(false);  // 字符串 200
>   expect(validateStatus(200)).toBe(true);    // 数字 200
> });
> ```

---

### 场景 2：不理解时提问

**User:**
> reviewer 说你的 CAS 实现有竞态条件问题

**✅ 正确的 AI 回应（被 review 者）:**
> 我理解你的担忧是：多个请求同时到达时，可能读取到过时的版本号，导致 CAS 检查失效。
>
> 需要澄清的是：
> 1. 这个竞态场景是在高并发下，还是任何并发都可能触发？
> 2. 你的建议是加锁，还是用数据库的原子 CAS 操作？
> 3. 我看到代码里用了 Redis 的 SETNX，这已经是一个 CAS 原语了，问题在哪里？

---

### 场景 3：Red-Green 验证

**User:**
> reviewer 说 `VERDICT` 解析 fail-open，`"需要修复"` 被判定为通过

**✅ 正确的 AI 回应（被 review 者）:**
> 问题定位：`parseVerdict()` 函数在解析失败时返回 `undefined`，然后在 `isValidVerdict()` 里 `!verdict` 判定为 true，这是 fail-open。
>
> 修复方案：
> 1. `parseVerdict()` 失败时抛出明确的错误
> 2. `isValidVerdict()` 只接受 `{ verdict: 'approved' | 'needs_fix' | 'rejected' }` 类型
>
> 验证测试：
> ```javascript
> // Red: 修复前这个测试应该失败
> test('VERDICT 解析失败应该抛出错误', () => {
>   expect(() => parseVerdict('invalid')).toThrow('Invalid verdict format');
> });
>
> // Green: 修复后应该通过
> test('需要修复的 VERDICT 不应该通过校验', () => {
>   const verdict = parseVerdict('{"verdict":"needs_fix"}');
>   expect(isValidVerdict(verdict)).toBe(false);
> });
> ```
>
> 运行测试：✅ 729 tests, 0 fail

---

## Red-Green 验证法则

**修复任何问题后，必须证明问题真正解决了：**

1. **Red**：写一个会失败的测试，复现 reviewer 指出的问题
   - 测试失败证明问题存在

2. **Green**：修复代码，让测试通过
   - 测试通过证明问题解决

3. **Regression**：确保没有破坏其他功能
   - 运行完整测试套件

**为什么必须这样做？**

- AI 的"改好了"可能只是"我觉得改好了"
- 测试是客观证据
- Red-Green 是 TDD 的核心，防止"修对了但不知道"

---

## 核心精神

**行动 > 言语。**

- 感谢不能证明你理解了问题
- 代码修复本身就是最好的回应
- 不理解时提问，不要假装理解

**代码本身证明你听到了反馈。**

---

## 角色提醒

**你是被 review 者，不是 reviewer。**

- ❌ 不要说"我来 review 这段代码"
- ❌ 不要去检查 reviewer 说的对不对（reviewer 已经审查过了）
- ✅ 理解问题 → 修复代码 → 验证解决

---

## 关键区别

| 角色 | 动作 | 状态 |
|------|------|------|
| **reviewer** | 检查代码，找出问题 | 已经完成 |
| **被 review 者** | 修复 reviewer 指出的问题 | 正在进行 |
| **你** | 被 review 者 | 修复代码 |
