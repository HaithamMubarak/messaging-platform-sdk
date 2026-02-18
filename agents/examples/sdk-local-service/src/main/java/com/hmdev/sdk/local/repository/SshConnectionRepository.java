package com.hmdev.sdk.local.repository;

import com.hmdev.sdk.local.model.SshConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface SshConnectionRepository extends JpaRepository<SshConnection, Long> {
    Optional<SshConnection> findByName(String name);
    boolean existsByName(String name);
}

