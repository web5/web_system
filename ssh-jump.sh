#!/usr/bin/expect -f
set timeout 60
set jump_pass ""
set micro_pass "<CLOUD_DB_PASSWORD>"
set cmd [lindex $argv 0]

spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -J root@192.0.2.30 root@10.0.16.2 $cmd
expect {
    "password:" { send "$micro_pass\r" }
    "Password:" { send "$micro_pass\r" }
    timeout { puts "TIMEOUT"; exit 1 }
    eof { }
}
expect {
    "password:" { send "$micro_pass\r"; exp_continue }
    "Password:" { send "$micro_pass\r"; exp_continue }
    eof { }
}
catch wait result
exit [lindex $result 3]
