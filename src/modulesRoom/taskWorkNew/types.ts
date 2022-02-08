import { EnvContext } from '@/utils'
import { RoomTaskMemory, TaskUnitInfo } from '@/modulesRoom/taskBaseNew'
import { RoleMemory } from '@/modulesRoom/unitControl'
import { SourceUtils } from '@/modulesGlobal/source'
import { UseSpawnContext } from '../spawn'
import { Goto } from '@/modulesGlobal/move'
import { WithDelayCallback } from '@/modulesGlobal/delayQueue'

export type WorkTaskContext = {
    getMemory: (room: Room) => WorkTaskMemory
    /**
     * 自定义移动
     * 用于接入对穿移动
     */
    goTo: Goto
    /**
     * 获取房间中的能量存放建筑
     * 应返回工作单位可以取能量的建筑
     *
     * @param pos 想要获取能量的爬在哪个位置上，可以用这个来查找最近的能量来源
     */
    getEnergyStructure: (room: Room, pos: RoomPosition) => EnergyTarget
    /**
     * 创建延迟任务
     */
    withDelayCallback: WithDelayCallback
    /**
     * source 管理工具
     */
    sourceUtils: SourceUtils
} & EnvContext & UseSpawnContext

export type WorkerRuntimeContext = (room: Room) => ({
    haveCreepBeenFired: (creepName: string) => boolean
    removeTaskByKey: (taskKey: number) => OK | ERR_NOT_FOUND
    countWorkTime: () => void
    countLifeTime: () => void
    getUnitTask: (creep: Creep) => AllRoomWorkTask
})

export type WorkTaskMemory = {
    creeps?: RoleMemory<TaskUnitInfo>
} & RoomTaskMemory<AllRoomWorkTask>

/**
 * 所有的工作任务类型
 */
export enum WorkTaskType {
    Upgrade = 'upgrade',
    Build = 'build',
    BuildStartContainer = 'buildStartContainer',
    Repair = 'repair',
    FillWall = 'fillWall',
}

/**
 * 所有的房间工作任务
 */
export type AllRoomWorkTask = WorkTasks[WorkTaskType]

/**
 * 所有的工作任务
 */
export interface WorkTasks {
    /**
     * 升级任务
     */
    [WorkTaskType.Upgrade]: RoomTask<WorkTaskType.Upgrade>
    /**
     * 建造任务
     */
    [WorkTaskType.Build]: RoomTask<WorkTaskType.Build>
    /**
     * 初始 source container 建造任务
     */
    [WorkTaskType.BuildStartContainer]: RoomTask<WorkTaskType.BuildStartContainer> & {
        /**
         * 修建哪个 source 的 container
         * 会自己去找这个 source 周边的 container 工地去修
         */
        sourceId: Id<Source>
        /**
         * 要修建的 container，执行任务时由 creep 自己储存
         */
        containerId?: Id<StructureContainer>
    }
    /**
     * 维修任务
     */
    [WorkTaskType.Repair]: RoomTask<WorkTaskType.Repair>
    /**
     * 刷墙任务
     */
    [WorkTaskType.FillWall]: RoomTask<WorkTaskType.FillWall>
}

export type WorkerActionStrategy<T extends WorkTaskType = WorkTaskType> = {
    source: WorkerActionStage<T>
    target: WorkerActionStage<T>
}

type WorkerActionStage<T extends WorkTaskType> = (
    creep: Creep,
    task: WorkTasks[T],
    workRoom: Room
) => boolean

export type WorkerGetEnergy = (creep: Creep, memory: unknown, workRoom: Room) => boolean
