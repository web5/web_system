#!/usr/bin/expect -f
set timeout 120
set password "<CLOUD_DB_PASSWORD>"
set local_path [lindex $argv 0]
set remote_path [lindex $argv 1]

spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -r $local_path root@198.51.100.20:$remote_path
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
