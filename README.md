# Metrics

![Build Status](https://github.com/janis-commerce/metrics/workflows/Build%20Status/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/janis-commerce/metrics/badge.svg?branch=master)](https://coveralls.io/github/janis-commerce/metrics?branch=master)
[![npm version](https://badge.fury.io/js/%40janiscommerce%2Fmetrics.svg)](https://www.npmjs.com/package/@janiscommerce/metrics)

A package for creating metrics in Firehose

## Installation
```sh
npm install @janiscommerce/metrics
```

## Configuration
### ENV variables
**`JANIS_SERVICE_NAME`** (required): The Role Session Name to assume role in order to put records in Firehose.
**`METRIC_ROLE_ARN`** (required): The ARN to assume role in order to put records in Firehose.

## API
### **`add(clientCode, metricName, metricData)`**
Parameters: `clientCode [String]`, `metricName [String]`, `metricData [Object] or [Object array]`
Puts the recieved metric or metrics into the janis-trace-firehose

### Metric structure
The `metricData [Object]` parameter have the following structure:
- **`metricData [Object|Array]`**: This property is a JSON that includes all the technical data about your metric.

### Metric example
```js
{
	deliveryDate: '2022-06-03T10:00:00.000Z',
	orderId: '629e578fd32fd43cd1e41944',
	salesChannelId: '629e5797f63b83029b4df49f',
	status: 'pending'
}
```

### **`on(event, callback)`**
Parameters: `event [String]`, `callback [Function]`
Calls a callback when the specified event is emitted.

## Errors

The errors are informed with a `MetricError`.
This object has a code that can be useful for a correct error handling.
The codes are the following:

| Code | Description                    |
|------|--------------------------------|
| 1    | Invalid metric                 |
| 2    | Firehose Error                 |
| 3    | Unknown stage name             |

- In case of error while sending your metrics to Firehose, this package will emit an event called `create-error`, you can handle it using the `on()` method.

## Usage
```js
const Metric = require('@janiscommerce/metrics');

// Single metric send
await Metric.add('some-client', 'order-fulfillment-status', {
	warehouseName: "Example Warehouse name",
	salesChannelId: "d555345345345as67a342a",
	salesChannelName: "Example Sales Channel name"
});

// Multiple metrics send
await Metric.add('some-client', 'order-fulfillment-status', [
	{
		warehouseName: "Example Warehouse name",
		salesChannelId: "629d269fbd8f5f5da8185ba3",
		salesChannelName: "Example Sales Channel name"
	},
	{
		warehouseName: "Other Example Warehouse name",
		salesChannelId: "629d26a36c3c06aefe297df2",
		salesChannelName: "Other Example Sales Channel name"
	}
]);

// Metric creation error handling
Metric.on('create-error', (metric, err) => {
	console.error(`An error occurred while creating the metric ${err.message}`);
});

### Serverless configuration

Returns an array with the hooks needed for Metric's serverless configuration according to [Serverless Helper](https://www.npmjs.com/package/sls-helper-plugin-janis). In `path/to/root/serverless.js` add:

```js
'use strict';

const { helper } = require('sls-helper'); // eslint-disable-line
const functions = require('./serverless/functions.json');
const Metric = require('@janiscommerce/metrics');

module.exports = helper({
	hooks: [
		// other hooks
        ...functions,
        ...Metric.serverlessConfiguration
	]
});
```