'use strict';

const Settings = require('@janiscommerce/settings');

module.exports = () => {

	const metricRoleArn = Settings.get('metricRoleArn');

	return [
		['envVars', {
			METRIC_ROLE_ARN: metricRoleArn
		}],
		['iamStatement', {
			action: 'Sts:AssumeRole',
			resource: metricRoleArn
		}]
	];
};
