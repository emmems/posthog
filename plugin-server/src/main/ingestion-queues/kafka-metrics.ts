import * as Sentry from '@sentry/node'
import { StatsD } from 'hot-shots'
import { Consumer } from 'kafkajs'
import { KafkaConsumer } from 'node-rdkafka-acosom'

import { Hub } from '../../types'

type PartitionAssignment = {
    readonly topic: string
    readonly partitions: readonly number[]
}

type MemberAssignment = {
    readonly version: number
    readonly partitionAssignments: readonly PartitionAssignment[]
    readonly userData: Buffer
}

let latestRequestQueueSize = 0
export function addMetricsEventListeners(consumer: Consumer, statsd: StatsD | undefined): void {
    const listenEvents = [
        consumer.events.GROUP_JOIN,
        consumer.events.CONNECT,
        consumer.events.DISCONNECT,
        consumer.events.STOP,
        consumer.events.CRASH,
        consumer.events.RECEIVED_UNSUBSCRIBED_TOPICS,
        consumer.events.REQUEST_TIMEOUT,
    ]

    listenEvents.forEach((event) => {
        consumer.on(event, () => {
            statsd?.increment('kafka_queue_consumer_event', { event })
        })
    })

    consumer.on(consumer.events.REQUEST, ({ payload }) => {
        statsd?.timing('kafka_queue_consumer_event_request_duration', payload.duration, 0.01)
        statsd?.timing('kafka_queue_consumer_event_request_pending_duration', payload.pendingDuration, 0.01)
    })

    consumer.on(consumer.events.REQUEST_QUEUE_SIZE, ({ payload }) => {
        latestRequestQueueSize = payload.queueSize
    })
}

export function addSentryBreadcrumbsEventListeners(consumer: KafkaConsumer): void {
    /** these events are a string literal union and, they're not exported so, we can't enumerate them
     *  type KafkaClientEvents = 'disconnected' | 'ready' | 'connection.failure' | 'event.error' | 'event.stats' | 'event.log' | 'event.event' | 'event.throttle';
     *  type KafkaConsumerEvents = 'data' | 'partition.eof' | 'rebalance' | 'rebalance.error' | 'subscribed' | 'unsubscribed' | 'unsubscribe' | 'offset.commit' | KafkaClientEvents;
     *
     *  some of them happen very frequently so, we don't want to capture them as breadcrumbs
     *  and the way the library is written if we listen to individual events then we get typed args we can capture
     *  with the breadcrumb
     */

    consumer.on('disconnected', (metrics) => {
        Sentry.addBreadcrumb({
            category: 'kafka_lifecycle',
            message: 'disconnected',
            level: 'info',
            data: {
                metrics,
            },
        })
    })

    consumer.on('connection.failure', (error) => {
        Sentry.addBreadcrumb({
            category: 'kafka_lifecycle',
            message: 'connection.failure',
            level: 'info',
            data: {
                error,
            },
        })
    })

    consumer.on('event.throttle', (eventData) => {
        Sentry.addBreadcrumb({
            category: 'kafka_lifecycle',
            message: 'event.throttle',
            level: 'info',
            data: {
                eventData,
            },
        })
    })

    consumer.on('rebalance', (error) => {
        Sentry.addBreadcrumb({
            category: 'kafka_lifecycle',
            message: 'rebalance',
            level: 'info',
            data: {
                error,
            },
        })
    })

    consumer.on('rebalance.error', (error) => {
        Sentry.addBreadcrumb({
            category: 'kafka_lifecycle',
            message: 'rebalance.error',
            level: 'info',
            data: {
                error,
            },
        })
    })
}

export async function emitConsumerGroupMetrics(
    consumer: Consumer,
    consumerGroupMemberId: string | null,
    pluginsServer: Hub
): Promise<void> {
    try {
        pluginsServer.statsd?.increment('kafka_consumer_request_queue_size', latestRequestQueueSize, {
            instanceId: pluginsServer.instanceId.toString(),
        })

        const timer = new Date()
        const description = await consumer.describeGroup()
        pluginsServer.statsd?.timing('kafka_consumer_emit_describe', timer)

        pluginsServer.statsd?.increment('kafka_consumer_group_state', {
            state: description.state,
            groupId: description.groupId,
            instanceId: pluginsServer.instanceId.toString(),
        })

        const descriptionWithAssignment = description.members.map((member) => ({
            ...member,
            assignment: parseMemberAssignment(member.memberAssignment),
        }))

        const consumerDescription = descriptionWithAssignment.find(
            (assignment) => assignment.memberId === consumerGroupMemberId
        )

        let isLive = false
        if (consumerDescription) {
            consumerDescription.assignment.partitionAssignments.forEach(({ topic, partitions }) => {
                isLive = isLive || partitions.length > 0
                pluginsServer.statsd?.gauge('kafka_consumer_group_assigned_partitions', partitions.length, {
                    topic,
                    memberId: consumerGroupMemberId || 'unknown',
                    groupId: description.groupId,
                    instanceId: pluginsServer.instanceId.toString(),
                })
            })
        }

        pluginsServer.statsd?.increment(isLive ? 'kafka_consumer_live' : 'kafka_consumer_group_idle', {
            memberId: consumerGroupMemberId || 'unknown',
            groupId: description.groupId,
            instanceId: pluginsServer.instanceId.toString(),
        })
    } catch (error) {
        pluginsServer.statsd?.increment('kafka_consumer_emit_describe_failure', {
            memberId: consumerGroupMemberId || 'unknown',
            instanceId: pluginsServer.instanceId.toString(),
        })
    }
}

// Lifted from https://github.com/tulios/kafkajs/issues/755
const parseMemberAssignment = (data: Buffer): MemberAssignment => {
    let currentOffset = 0

    const version = data.readInt16BE(currentOffset)

    currentOffset += 2

    const partitionAssignmentCount = data.readInt32BE(currentOffset)

    currentOffset += 4

    const partitionAssignments = []

    for (let n = 0; n < partitionAssignmentCount; n += 1) {
        const topicNameLength = data.readInt16BE(currentOffset)

        currentOffset += 2

        const topic = data.slice(currentOffset, currentOffset + topicNameLength).toString('utf-8')

        currentOffset += topicNameLength

        const partitionCount = data.readInt32BE(currentOffset)

        currentOffset += 4

        const partitions = []

        for (let n2 = 0; n2 < partitionCount; n2 += 1) {
            const partition = data.readInt32BE(currentOffset)

            currentOffset += 4

            partitions.push(partition)
        }

        const partitionAssignment = { topic, partitions } as const

        partitionAssignments.push(partitionAssignment)
    }

    const userData = data.slice(currentOffset)

    const memberAssignment = { version, partitionAssignments, userData } as const

    return memberAssignment
}
