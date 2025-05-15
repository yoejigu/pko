//import * as k8s from "@pulumi/kubernetes";

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Client } from "pg";

// Config
const config = new pulumi.Config();
const region = aws.config.region;
const dbPassword = config.requireSecret("dbPassword");
const dbUsername = "yteDemoAdmin";
const dbName = "my_app_db";
const newDb = "client_connection_db"


// 🔧 Create a custom VPC
const vpc = new aws.ec2.Vpc("custom-vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: "custom-vpc" },
  });
  
  // 📡 Create an Internet Gateway
  const igw = new aws.ec2.InternetGateway("vpc-igw", {
    vpcId: vpc.id,
  });
  
  // 🛣️ Route Table and association
  const routeTable = new aws.ec2.RouteTable("vpc-rt", {
    vpcId: vpc.id,
    routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
  });
  
  // 🌐 Create 2 public subnets in different AZs
  const subnet1 = new aws.ec2.Subnet("subnet-1", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "us-east-1a",
    mapPublicIpOnLaunch: true,
    tags: { Name: "subnet-1" },
  });
  
  const subnet2 = new aws.ec2.Subnet("subnet-2", {
    vpcId: vpc.id,
    cidrBlock: "10.0.2.0/24",
    availabilityZone: "us-east-1b",
    mapPublicIpOnLaunch: true,
    tags: { Name: "subnet-2" },
  });
  
  // Associate subnets with the route table
  new aws.ec2.RouteTableAssociation("rta-1", {
    subnetId: subnet1.id,
    routeTableId: routeTable.id,
  });
  new aws.ec2.RouteTableAssociation("rta-2", {
    subnetId: subnet2.id,
    routeTableId: routeTable.id,
  });
  
  // 🔐 Security Group for RDS
  const dbSg = new aws.ec2.SecurityGroup("db-sg", {
    vpcId: vpc.id,
    description: "Allow Postgres",
    ingress: [{
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      cidrBlocks: ["108.48.101.90/32"], // ⚠️ Restrict this in production
    }],
    egress: [{
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    }],
  });
  
  // 🧱 Subnet group for RDS
  const dbSubnetGroup = new aws.rds.SubnetGroup("rds-subnet-group", {
    subnetIds: [subnet1.id, subnet2.id],
    tags: { Name: "rds-subnet-group" },
  });
  

// 📦 RDS Instance
const db = new aws.rds.Instance("my-db", {
    engine: "postgres",
    engineVersion: "17.2",
    instanceClass: "db.t3.micro",
    allocatedStorage: 20,
    dbName,
    username: dbUsername,
    password: dbPassword,
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [dbSg.id],
    skipFinalSnapshot: true,
    publiclyAccessible: true,
  });
  
  // 🔐 Store credentials in Secrets Manager
  const secret = new aws.secretsmanager.Secret("db-creds");
  const secretVersion = new aws.secretsmanager.SecretVersion("db-creds-version", {
    secretId: secret.id,
    secretString: pulumi
      .all([db.address, db.port, dbPassword])
      .apply(([address, port, password]) =>
        JSON.stringify({
          host: address,
          port,
          username: dbUsername,
          password,
          database: "postgres",
        })
      ),
  });
  
  //🧠 Connect to RDS and initialize schema
  const provision = pulumi
    .all([db.address, db.port, dbPassword])
    .apply(async ([address, port, password]) => {
      const client = new Client({
        host: address,
        port,
        user: dbUsername,
        password: password,
        database: dbName,
        ssl: {
            rejectUnauthorized: false, // disable cert validation (for now)
          },
      });
  
      await client.connect();
      console.log("🔗 Connected to DB");
  
      await client.query(`CREATE DATABASE ${newDb};`);
      console.log(`✅ Created database: ${newDb}`);
  
      await client.end();
  
      return pulumi.secret(`Logical DB '${newDb}' created at ${address}`);
    });
  
  // 🔎 Exports
  export const rdsEndpoint = db.endpoint;
  export const vpcId = vpc.id;
  export const dbSubnetGroupName = dbSubnetGroup.name;
  export const credentialsSecretArn = secret.arn;
  export const dbProvisioningMessage = provision;


// const appLabels = { app: "nginx" };
// const deployment = new k8s.apps.v1.Deployment("nginx", {
//     spec: {
//         selector: { matchLabels: appLabels },
//         replicas: 1,
//         template: {
//             metadata: { labels: appLabels },
//             spec: { containers: [{ name: "nginx", image: "nginx" }] }
//         }
//     }
// });
// export const name = deployment.metadata.name;
