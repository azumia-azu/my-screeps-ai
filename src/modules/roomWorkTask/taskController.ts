import { getRoomStats } from 'modules/stateCollector'
import { noTask, transportActions } from './actions'

/**
 * 能量获取速率到调整期望的 map
 * 能量获取速率越高，工人数量就越多
 * 
 * @todo 下面的速率到期望的值还需要实测确定
 * 
 * @property {} rate 能量获取速率
 * @property {} expect 对应的期望
 */
const WORK_PROPORTION_TO_EXPECT = [
    { rate: 50, expect: 2 },
    { rate: 10, expect: 1 },
    { rate: -10, expect: 0 },
    { rate: -50, expect: -1 },
    { rate: -100, expect: -2 }
]

export default class RoomWork implements RoomWorkType {
    /**
     * 本工作对象所处的房间名
     */
    readonly roomName: string

    /**
     * 当前正在执行的所有工作任务
     */
    tasks: AllRoomWorkTask[] = []

    /**
     * 构造- 管理指定房间的工作任务
     * 
     * @param roomName 要管理任务的房间名
     */
    constructor(roomName: string) {
        this.roomName = roomName
        this.initTask()
    }

    /**
     * 添加一个工作任务
     * 不允许添加相同类型的任务，若添加时已存在同类型任务将会进行覆盖
     */
    public addTask(task: AllRoomWorkTask): void {
        // 发布任务的时候为了方便可以不填这个，这里给它补上
        if (!task.executor) task.executor = []

        // 如果存在原始任务的话就剔除
        this.tasks = this.tasks.filter(existTask => existTask.type !== task.type)

        // 因为 this.tasks 是按照优先级降序的，所以这里要找到新任务的插入索引
        let insertIndex = this.tasks.length
        this.tasks.find((existTask, index) => {
            // 老任务的优先级更高，不能在这里插入
            if (existTask.priority >= task.priority) return false

            insertIndex = index
            return true
        })

        // 在目标索引位置插入新任务并重新分配任务
        this.tasks.splice(insertIndex, 0, task)
        this.dispatchTask()
        this.saveTask()
    }

    /**
     * 通过任务类型获取指定任务
     * 
     * @param taskType 要查询的任务类型
     * @returns 对应的任务，没有的话则返回 undefined
     */
    public getTask(taskType: AllWorkTaskType): AllRoomWorkTask | undefined {
        if (!taskType) return undefined

        return this.tasks.find(task => task.type === taskType) as AllRoomWorkTask
    }

    /**
     * 从内存中重建任务队列
     */
    private initTask() {
        if (!Memory.rooms || Memory.rooms[this.roomName]) return;
        // 从内存中解析数据
        const taskData: WorkTaskData = JSON.parse(Memory.rooms[this.roomName].workTasks || '[]')
        this.tasks = taskData
    }

    /**
     * 将本房间工作任务都保存至内存
     */
    private saveTask() {
        if (!Memory.rooms) Memory.rooms = {}
        Memory.rooms[this.roomName].workTasks = JSON.stringify(this.tasks)
    }

    /**
     * 进行任务调度
     * 给当前现存的任务按照优先级重新分配 creep
     */
    private dispatchTask() {
        // 找到所有缺人手的任务
        let unstartTasks = this.tasks.filter(task => task.executor.length <= 0)
        
        // 生成遍历索引，例如任务数组长度为 5，将返回 4 3 2 1 0 1 2 3 4
        const forItem = [
            ...[...Array(this.tasks.length).keys()].reverse(),
            ...[...Array(this.tasks.length).keys()].splice(1)
        ]
        // 先优先级从低往高遍历，让额外的工人往高优先级任务富集
        // 然后优先级从高到低遍历，避免高优先级任务很多人而低优先级任务没人做
        for (const i of forItem) {
            const currentTask = this.tasks[i]

            // 没有多余工人，检查下一个任务
            if (currentTask.executor.length <= 1) continue

            const extraWorkers = this.getExtraWorker(currentTask)
            // 把多余的工人分配到缺人的任务上
            // 如果自己帮不了的话，就会把任务存放到 cantHelpTask 交给下个任务帮忙
            const cantHelpTask = []
            for (let j = 0; j < unstartTasks.length; j++) {
                const checkTask = unstartTasks[j]

                // 检查下自己有没有该任务缺的人，有就分一个给他
                const neededWorker = extraWorkers[String(checkTask.require)]
                if (neededWorker && neededWorker.length > 0) {
                    checkTask.executor.push(neededWorker.shift().id)
                }
                // 该任务是特殊任务并且自己没有对应类型的，就分一个普通工人过去
                else if (checkTask.require) {
                    checkTask.executor.push(extraWorkers['undefined'].shift().id)
                }
                else cantHelpTask.push(checkTask)

                // 如果人都分完了就结束多余工人分配
                if (Object.values(extraWorkers).every(workers => workers.length <= 0)) {
                    cantHelpTask.push(...unstartTasks.splice(j + 1))
                    break
                }
            }

            // 安置所有的未分配单位
            Object.keys(extraWorkers).forEach(workerType => {
                if (extraWorkers[workerType].length <= 0) true

                // 这里需要检查下
                const pushTarget = (
                    // 如果最高级任务只需要一个，就不往最高级分了
                    !this.tasks[0].need1 ||
                    // 或者额外的工人必须是符合最高优先级任务需求的才能分给最高级任务，不然就继续去做原先的任务
                    workerType === this.tasks[0].require ||
                    workerType === 'undefined'
                ) ? this.tasks[0] : currentTask

                pushTarget.executor.push(...extraWorkers[workerType].map(creep => creep.id))
            })

            unstartTasks = cantHelpTask
            // 如果还有没完成的任务，就继续进行循环
            if (unstartTasks.length <= 0) break
        }

        // 如果现在还有没做完的任务的话，就说明人手不够了，从低等级任务调人
        // 这里调人和上面的区别在于，上面会保留至少一个，这里会直接把最后一个调过去
        if (unstartTasks.length > 0) {
            for (let i = this.tasks.length - 1; i >= 0; i--) {
                const lowTask = this.tasks[i]

                // lowTask 是当前优先级最低的任务，而 unstartTasks[0] 是这个数组里优先级最高的任务
                // 如果优先级最低的 lowTask 都比 unstartTasks[0] 高的话，那就没有必要比下去了，后面的肯定也是更高
                if (lowTask.priority >= unstartTasks[0].priority) break

                // 如果这个任务也没人的话就检查下一个任务
                // 这里只对比 lowTask.executor[0] 的身体类型是因为走到这一步时每个任务肯定只有一个工人了
                // （不然早在上面的循环里分配给 unstartTasks 了）
                if (lowTask.executor.length <= 0) continue

                const worker = Game.getObjectById(lowTask.executor[0])
                // 唯一干活的还是个死人（太可怜了），移除并检查下一个
                if (!worker) {
                    lowTask.executor.shift()
                    continue
                }
                // 工人类型不符合，检查下一个
                if (worker.memory.bodyType !== lowTask.require) continue

                // 低优先级任务把自己的工人传递给高优先级任务
                unstartTasks[0].executor.push(lowTask.executor.shift())
                // 移除这个已经分配完的任务
                unstartTasks.shift()
                if (unstartTasks.length <= 0) break
            }
        }
    }

    /**
     * 从任务中剥离额外的工人
     * 会修改传入任务的执行工人数组
     * 
     * @param task 要剥离额外工人的任务
     */
    private getExtraWorker(task: AllRoomWorkTask): _.Dictionary<Creep[]> {
        const workingCreep = task.executor.map(id => Game.getObjectById(id)).filter(Boolean)

        // 是特殊任务
        if (task.require) {
            // 找到需要的工人
            const requireWorker = workingCreep.find((worker, index) => {
                if (worker.memory.bodyType !== task.require) return false

                task.executor.splice(index, 1)
                return true
            })

            // 如果有的话就把其他的工人返回出去
            if (requireWorker) {
                const extraWorkers = workingCreep
                task.executor = [requireWorker.id]

                return _.groupBy(extraWorkers, w => w.memory.bodyType)
            }
        }

        task.executor = [workingCreep[0].id]
        // 不是特殊任务，或者是特殊任务但是没有对应的特殊工人
        return _.groupBy(workingCreep.splice(1), w => w.memory.bodyType)
    }

    /**
     * 给工作单位分配任务
     * 
     * @param creeps 要分配任务的 creep 
     */
    private giveJob(creeps: Creep[]) {
        let needRedispath = false

        // 直接塞到优先级最低的任务里，后面会重新分派
        for (const creep of creeps) {
            for (let i = this.tasks.length - 1; i > 0; i--) {
                if (
                    // 身体类型不符合需求
                    this.tasks[i].require !== creep.memory.bodyType ||
                    // 或者该任务只需要一个工作单位
                    this.tasks[i].need1 && this.tasks[i].executor.length > 1
                ) continue

                this.tasks[i].executor.push(creep.id)
                needRedispath = true
            }
        }

        needRedispath && this.dispatchTask()
    }

    /**
     * 获取应该执行的任务逻辑
     * 会通过 creep 内存中存储的当前执行任务字段来判断应该执行那个任务
     */
    public getWork(creep: MyCreep<'manager'>): RoomTaskAction {
        let task = this.getTask(creep.memory.workTaskType)

        // 是新人，分配任务
        if (!task) {
            // 这里直接返回了，所以摸鱼时不会增加工作时长
            if (this.tasks.length <= 0) return noTask(creep)

            this.giveJob([creep])
            this.saveTask()
            // 分配完后重新获取任务
            task = this.getTask(creep.memory.workTaskType)
        }
        const actionGenerator: WorkActionGenerator = transportActions[task.type]

        // 分配完后获取任务执行逻辑
        return actionGenerator(creep, task)
    }

    /**
     * 是否存在某个任务
     * 
     * @returns 存在则返回该任务及其在 this.tasks 中的索引，不存在则返回 undefined
     */
    public hasTask(taskType: AllWorkTaskType): boolean {
        return !!this.tasks.find(task => task.type === taskType)
    }

    /**
     * 移除一个任务
     * 
     * @param taskType 要移除的任务类型
     */
    public removeTask(taskType: AllWorkTaskType): OK | ERR_NOT_FOUND {
        this.tasks.find((task, index) => {
            if (task.type !== taskType) return false

            // 删除该任务
            this.tasks.splice(index, 1)
            // 给干完活的搬运工重新分配任务
            const extraCreeps = task.executor.map(id => Game.getObjectById(id)).filter(Boolean)
            this.giveJob(extraCreeps)
            return true
        })

        this.saveTask()
        return OK
    }

    /**
     * 获取当前的工人调整期望
     * 返回的整数值代表希望增加（正值）/ 减少（负值）多少工作单位
     * 返回 0 代表不需要调整工作单位数量
     */
    public getExpect(): number {
        const stats = getRoomStats(this.roomName)
        // 没有统计或者能量获取速率为零，不调整搬运工数量
        if (!stats || !stats.energyGetRate) return 0

        // 工作时长占比从高到底找到期望调整的搬运工数量
        const currentExpect = WORK_PROPORTION_TO_EXPECT.find(opt => stats.energyGetRate >= opt.rate)

        return currentExpect?.expect !== undefined ? currentExpect.expect : -2
    }
}