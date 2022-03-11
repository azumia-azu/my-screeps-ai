import { goTo, setCreepStand } from '@/modulesGlobal/move'
import { createRemoteController, RemoteMemory } from '@/modulesRoom/remote'
import { createEnvContext } from '@/utils'
import { withDelayCallback } from '../global/delayQueue'
import { getLink, getContainer, getSource, getSpawn } from './shortcut'
import { addSpawnCallback } from './spawn'
import { confirmBasePos, findBaseCenterPos } from '@/modulesGlobal/autoPlanning'
import { setBaseCenter } from './autoPlanner'
import { CreepRole } from '../creep/types'
import { buildRoom } from '../creep/methods'

declare global {
    interface RoomMemory {
        /**
         * 房间扩张模块内存
         */
        remote: RemoteMemory
    }
}

export const getRemoteController = createRemoteController({
    remoteHarvesterRole: CreepRole.RemoteHarvester,
    reserverRole: CreepRole.Reserver,
    claimerRole: CreepRole.Claimer,
    remtoeHelperRole: CreepRole.RemoteHelper,
    signerRole: CreepRole.Signer,
    withDelayCallback,
    goTo,
    getMemory: room => {
        if (!room.memory.remote) room.memory.remote = {}
        return room.memory.remote
    },
    buildRoom,
    getLink,
    getContainer,
    getSource,
    getSpawn,
    addSpawnTask: (room, ...args) => room.spawnController.addTask(...args),
    addSpawnCallback,
    onCreepStageChange: (creep, isWorking) => setCreepStand(creep.name, isWorking),
    onBaseCenterConfirmed: setBaseCenter,
    confirmBaseCenter: confirmBasePos,
    findBaseCenterPos: findBaseCenterPos,
    env: createEnvContext('remote')
})
