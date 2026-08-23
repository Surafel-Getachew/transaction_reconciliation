import fs from 'node:fs';
import path from 'node:path';

function parseArgs(): { records: number; outputPath: string } {
  let records = 10000;
  let outputPath = './sample_transactions.ndjson';

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--records=')) {
      records = parseInt(arg.split('=')[1], 10) || records;
    } else if (arg.startsWith('--output=')) {
      outputPath = arg.split('=')[1];
    }
  }

  return { records, outputPath };
}

function generateData() {
  const { records, outputPath } = parseArgs();
  console.log(`Generating ${records} NDJSON transaction records to ${outputPath}...`);

  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INVALID_CURR'];
  const merchants = ['merchant-1', 'merchant-2', 'merchant-3', 'merchant-4', 'merchant-5'];
  const accounts = ['acc-101', 'acc-102', 'acc-103', 'acc-104', 'acc-105'];

  const dir = path.dirname(outputPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  for (let i = 1; i <= records; i++) {
    // Inject deliberate test cases periodically
    if (i % 500 === 0) {
      // Invalid JSON
      writeStream.write(`{"transactionId":"txn-${i}","accountId":"acc-1", BROKEN_JSON}\n`);
      continue;
    }

    if (i % 750 === 0) {
      // Duplicate transactionId from earlier record
      const dupId = Math.max(1, i - 100);
      const record = {
        transactionId: `txn-${dupId}`,
        accountId: accounts[i % accounts.length],
        merchantId: merchants[i % merchants.length],
        amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: `Duplicate transaction attempt ${i}`,
      };
      writeStream.write(JSON.stringify(record) + '\n');
      continue;
    }

    if (i % 1000 === 0) {
      // Invalid currency code
      const record = {
        transactionId: `txn-${i}`,
        accountId: accounts[i % accounts.length],
        merchantId: merchants[i % merchants.length],
        amount: 150.0,
        currency: 'XYZ_INVALID',
        timestamp: new Date().toISOString(),
        description: 'Unsupported currency test',
      };
      writeStream.write(JSON.stringify(record) + '\n');
      continue;
    }

    // Standard valid transaction record
    const record = {
      transactionId: `txn-${i}`,
      accountId: accounts[i % accounts.length],
      merchantId: merchants[i % merchants.length],
      amount: parseFloat((Math.random() * 1000 + 5).toFixed(2)),
      currency: currencies[i % (currencies.length - 1)], // Pick valid currency
      timestamp: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 30)).toISOString(),
      description: `Payment transaction ${i}`,
    };

    writeStream.write(JSON.stringify(record) + '\n');
  }

  writeStream.end();
  writeStream.on('finish', () => {
    const stats = fs.statSync(outputPath);
    console.log(`Generated ${outputPath} successfully (${(stats.size / 1024 / 1024).toFixed(2)} MB).`);
  });
}

generateData();
