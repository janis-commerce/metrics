'use strict';

const { struct } = require('@janiscommerce/superstruct');

const { v4: UUID } = require('uuid');

const MetricError = require('../metric-error');

const metricStruct = {
	id: 'string&!empty',
	service: 'string&!empty',
	client: 'string&!empty',
	name: 'string?',
	metric: 'object|array?',
	userCreated: 'string|null?'
};

module.exports = (rawMetric, client, serviceName) => {

	try {
		const Struct = struct.partial(metricStruct, {
			id: UUID(),
			service: serviceName,
			client
		});

		const validMetric = Struct(rawMetric);

		if(validMetric.metric)
			validMetric.metric = JSON.stringify(validMetric.metric);

		if(validMetric.userCreated === null)
			delete validMetric.userCreated;

		return {
			...validMetric,
			dateCreated: new Date().toISOString()
		};

	} catch(err) {
		throw new MetricError(err.message, MetricError.codes.INVALID_METRIC);
	}
};
