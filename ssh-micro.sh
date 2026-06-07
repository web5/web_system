#!/usr/bin/expect -f
set timeout 60
set password "<CLOUD_DB_PASSWORD>"
set host "root@198.51.100.20"
set cmd [lindex $argv 0]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 $host $cmd
expect {
    "password:" { send "$password\r" }
    "Password:" { send "$password\r" }
    timeout { puts "TIMEOUT"; exit 1 }
    eof { }
}
expect {
    "password:" { send "$password\r"; exp_continue }
    "Password:" { send "$password\r"; exp_continue }
    eof { }
}
catch wait result
exit [lindex $result 3]
