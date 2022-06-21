'use strict';

const { struct } = require('@janiscommerce/superstruct');

const MetricError = require('../metric-error');

const MetricStruct = struct.partial({
	clientCode: 'string&!empty',
	metricName: 'string&!empty',
	metricData: 'object|array'
});

module.exports = (clientCode, metricName, metricData) => {

	try {

		const validMetric = MetricStruct({
			clientCode,
			metricName,
			metricData
		});

		return {
			...validMetric,
			dateCreated: new Date().toISOString()
		};

	} catch(err) {
		throw new MetricError(err.message, MetricError.codes.INVALID_METRIC);
	}
};
