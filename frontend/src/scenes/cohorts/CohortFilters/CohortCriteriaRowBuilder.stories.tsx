import { useState } from 'react'
import { Meta } from '@storybook/react'
import {
    CohortCriteriaRowBuilder,
    CohortCriteriaRowBuilderProps,
} from 'scenes/cohorts/CohortFilters/CohortCriteriaRowBuilder'
import { taxonomicFilterMocksDecorator } from 'lib/components/TaxonomicFilter/__mocks__/taxonomicFilterMocksDecorator'
import { useMountedLogic } from 'kea'
import { actionsModel } from '~/models/actionsModel'
import { cohortsModel } from '~/models/cohortsModel'
import { BehavioralFilterType } from 'scenes/cohorts/CohortFilters/types'
import { BehavioralEventType } from '~/types'
import { Form } from 'kea-forms'
import { cohortEditLogic } from 'scenes/cohorts/cohortEditLogic'

const meta: Meta<typeof CohortCriteriaRowBuilder> = {
    title: 'Filters/Cohort Filters/Row Builder',
    component: CohortCriteriaRowBuilder,
    decorators: [taxonomicFilterMocksDecorator],
}
export default meta

export function _CohortCriteriaRowBuilder(props: CohortCriteriaRowBuilderProps): JSX.Element {
    useMountedLogic(actionsModel)
    useMountedLogic(cohortsModel)
    useMountedLogic(cohortEditLogic({ id: 1 }))
    const [type, setType] = useState<BehavioralFilterType>(BehavioralEventType.PerformEvent)

    return (
        <Form logic={cohortEditLogic} props={{ id: 1 }} formKey={'cohort'}>
            <CohortCriteriaRowBuilder {...props} criteria={{}} type={type} onChangeType={setType} />
        </Form>
    )
}
