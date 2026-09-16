# 仿真世界与课程平台接口约定 v1

## 职责

- 仿真世界：设备注册、位置/心跳、视野内事件发现、接收任务、模拟移动及采样、回传执行结果。
- 业务平台：设备台账、事件持久化、选择设备、下发/取消任务、重试、告警检索及人工处置。
- 目前 `simulation.js` 的自动派遣是**本地演示调度**，让独立前端可以运行完整演练。尚未连接消息队列或网络接口。真实平台接入后应关闭此调度，避免双重分配。

当前前端把注册、遥测、发现、确认和结果信封写入本地 `messages` 队列。它只是待发送协议事件，不代表 Kafka 已经收到消息。后续接入服务应消费该队列或替换本地传输适配器，仿真移动与任务状态机无需因此重写。

## 设备生命周期边界

1. 仿真端新建设备代表创建一台虚拟硬件实例：分配稳定 `deviceId` 和集结中心停靠位，并发送 `device.register`。
2. 平台设备台账接收注册后管理在线、停用和调度状态；平台停用设备不等于删除仿真实例。
3. 仿真端移除设备前取消当前任务并发送 `device.offline`，平台保留设备、任务和事件历史。
4. 进程异常退出时无法主动发送离线消息，平台应按心跳超时将设备标记为离线。
5. “归位”属于 `RETURN_HOME` 指令：设备真实移动至集结中心停靠位，不删除设备，也不清空历史。
6. 地图布设的灾情属于仿真世界内部事实。只有无人机进入检测范围后，才向业务平台发送 `event.discovered`。

## 统一信封

```json
{
  "schemaVersion": "1.0",
  "messageId": "UUID",
  "sessionId": "UUID",
  "type": "task.command",
  "timestamp": "2026-09-14T08:30:00.000Z",
  "source": "platform",
  "deviceId": "UUID",
  "correlationId": "task UUID",
  "payload": {
    "commandId": "UUID",
    "taskId": "UUID",
    "eventId": "UUID",
    "action": "INSPECT",
    "target": {"x": -9, "z": -3},
    "expiresAt": "2026-09-14T08:35:00.000Z"
  }
}
```

场景采用米制局部坐标：x/z 为水平位置，y 为绝对海拔。地面高度来自共享地形函数；无人机离地高度为 y − terrainHeight。时间信封使用真实 UTC 时间；仿真进度另用 `simulationTimeSeconds`，不可混淆。平台以 116.400000°E、39.910000°N 为演示锚点做固定换算，不把局部坐标直接冒充真实 GIS 定位。

## 消息与建议 Kafka topic

| type | 方向 | topic | payload 必要内容 |
|---|---|---|---|
| device.register | 仿真 → 平台 | sim.device.lifecycle | name、deviceType、capabilities |
| device.telemetry | 仿真 → 平台 | sim.device.telemetry | sequence、position、battery、state、taskId、simulationTimeSeconds |
| event.discovered | 仿真 → 平台 | sim.event.discovered | eventId、eventType、position、severity、discoveredBy、evidenceMetadata |
| task.command | 平台 → 仿真 | sim.task.command | commandId、taskId、eventId、action、target、expiresAt |
| task.ack | 仿真 → 平台 | sim.task.feedback | commandId、accepted、reason |
| task.progress | 仿真 → 平台 | sim.task.feedback | taskId、phase、progress、position |
| task.result | 仿真 → 平台 | sim.task.feedback | taskId、outcome、observations、evidenceMetadata |
| device.offline | 仿真 → 平台 | sim.device.lifecycle | reason、lastSequence |

命令 action：SEARCH、INSPECT、RETURN_HOME、CANCEL。设备状态：IDLE、TAKING_OFF、SEARCHING、MOVING、INSPECTING、RETURNING、OFFLINE。结果 outcome：SUCCEEDED、FAILED、CANCELLED；常用失败原因 DEVICE_BUSY、LOW_BATTERY、NO_PATH、EXPIRED、UNKNOWN_DEVICE。

## 投递与一致性约定

1. command topic 按 deviceId 分区；反馈消息携带 taskId/commandId，方便追踪。
2. 相同 commandId 重复投递应返回已有确认，不创建第二个任务。平台只在收到 ack 后标记已接收。
3. 同一设备仅接受一个执行任务；CANCEL 指向特定 taskId。删除设备前取消任务并发送离线事件。
4. telemetry 按 sequence 忽略旧消息；重要事件和结果按 messageId 去重。
5. 建议心跳 1 秒，离线阈值 5 秒（真实时间）；参数由平台配置。仿真暂停不应假装网络离线。
6. 人工注入的灾情在仿真世界先存在；只有进入搜索范围才发布 event.discovered。调试界面可显示全部灾情，业务平台应区分“注入事实”与“设备已发现”。
7. 图片字节通过平台上传接口进入 HDFS；消息只传文件引用、校验值及元数据。禁止把图片元数据冒充图片文件。

## 后续接入顺序

当前已实现浏览器仿真端通过 Spring Boot 接入层上报 register/telemetry/discovered/ack/progress/result，并领取平台 task.command。默认开发模式使用本地命令队列；启用 `integration` 配置后，消息进入 Kafka，由消费者归档 MongoDB、写入 Elasticsearch，任务指令也经 Kafka 再投递到仿真端。HDFS 由平台上传接口负责文件字节存储。
